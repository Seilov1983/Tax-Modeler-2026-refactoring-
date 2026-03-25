#!/usr/bin/env python3
"""
TSM26 Strategy Copilot — LangChain Agent with Ollama & Tool Binding.

Configures a LangChain ReAct agent backed by the local Ollama instance
(tsm26-strategy-copilot model) with two bound tools:

  1. get_canvas_structure — retrieves the current corporate structure from
     the TSM26 canvas (nodes, edges, jurisdictions) for risk analysis.
  2. calculate_tax_flow — invokes the TSM26 math kernel (engine-tax) to
     simulate WHT, CIT, and ETR for a cross-border payment.

The agent also has access to the RAG knowledge base (ChromaDB) for
context-augmented generation on KZ tax law, AIFC, CFC rules, DTT, etc.

Usage:
    python3 src/agent/strategy_copilot.py
"""

import os
import sys
import json

# ─── Configuration ────────────────────────────────────────────────────────────

OLLAMA_BASE_URL = os.environ.get('OLLAMA_BASE_URL', 'http://127.0.0.1:11434')
MODEL_ID = os.environ.get('OLLAMA_MODEL', 'tsm26-strategy-copilot')
EMBEDDING_MODEL = os.environ.get('EMBEDDING_MODEL', 'nomic-embed-text')
CHROMADB_DIR = os.path.join(os.path.dirname(__file__), '..', '..', '.chromadb')
COLLECTION_NAME = 'tsm26_knowledge_base'
TSM26_API_BASE = os.environ.get('TSM26_API_BASE', 'http://localhost:3000')


# ─── Tool Definitions ────────────────────────────────────────────────────────

def get_canvas_structure(project_id: str) -> str:
    """Получает текущую корпоративную структуру с Канваса (узлы, связи, юрисдикции) для анализа рисков."""
    import requests
    try:
        resp = requests.get(
            f'{TSM26_API_BASE}/api/projects/{project_id}',
            timeout=10,
        )
        if resp.status_code == 200:
            data = resp.json()
            graph = data.get('graphJSON', {})
            # Extract relevant structure for LLM context
            summary = {
                'nodes': [
                    {
                        'id': n.get('id'),
                        'name': n.get('name'),
                        'type': n.get('type'),
                        'jurisdiction': None,
                        'zoneId': n.get('zoneId'),
                        'annualIncome': n.get('annualIncome', 0),
                        'etr': n.get('etr', 0),
                    }
                    for n in graph.get('nodes', [])
                ],
                'ownership': [
                    {
                        'fromId': o.get('fromId'),
                        'toId': o.get('toId'),
                        'percent': o.get('percent', 0),
                    }
                    for o in graph.get('ownership', [])
                ],
                'flows': [
                    {
                        'fromId': f.get('fromId'),
                        'toId': f.get('toId'),
                        'flowType': f.get('flowType'),
                        'grossAmount': f.get('grossAmount', 0),
                        'currency': f.get('currency'),
                    }
                    for f in graph.get('flows', [])
                ],
                'zones': [
                    {
                        'id': z.get('id'),
                        'name': z.get('name'),
                        'jurisdiction': z.get('jurisdiction'),
                        'code': z.get('code'),
                    }
                    for z in graph.get('zones', [])
                ],
            }
            return json.dumps(summary, ensure_ascii=False, indent=2)
        else:
            return json.dumps({'error': f'API returned {resp.status_code}'})
    except Exception as e:
        return json.dumps({'error': str(e)})


def calculate_tax_flow(
    from_zone_id: str,
    to_zone_id: str,
    flow_type: str,
    amount: float,
    apply_dtt: bool = False,
) -> str:
    """Вызывает математическое ядро TSM26 (engine-tax) для расчета WHT, CIT и ETR при симуляции выплаты."""
    import requests
    try:
        payload = {
            'messages': [{'role': 'user', 'content': 'calculate'}],
            'tool_call': {
                'fromZoneId': from_zone_id,
                'toZoneId': to_zone_id,
                'flowType': flow_type,
                'amount': amount,
                'applyDtt': apply_dtt,
            },
        }
        resp = requests.post(
            f'{TSM26_API_BASE}/api/chat',
            json=payload,
            timeout=30,
        )
        if resp.status_code == 200:
            return resp.text
        else:
            return json.dumps({
                'error': f'TSM26 API returned {resp.status_code}',
                'detail': resp.text[:200],
            })
    except Exception as e:
        return json.dumps({'error': str(e)})


# ─── LangChain Tool Registration ─────────────────────────────────────────────

def build_tools():
    """Register the two tool schemas with LangChain."""
    from langchain_core.tools import StructuredTool
    from pydantic import BaseModel, Field
    from enum import Enum

    class FlowTypeEnum(str, Enum):
        dividends = 'dividends'
        royalties = 'royalties'
        interest = 'interest'
        services = 'services'

    class GetCanvasStructureInput(BaseModel):
        project_id: str = Field(
            description='ID проекта в TSM26 для загрузки структуры',
        )

    class CalculateTaxFlowInput(BaseModel):
        from_zone_id: str = Field(description='Zone ID отправителя (payer)')
        to_zone_id: str = Field(description='Zone ID получателя (payee)')
        flow_type: FlowTypeEnum = Field(
            description='Тип выплаты: dividends, royalties, interest, services',
        )
        amount: float = Field(description='Gross amount выплаты')
        apply_dtt: bool = Field(
            default=False,
            description='Применить ставку по Конвенции (DTT/СИДН)',
        )

    tool_get_canvas = StructuredTool.from_function(
        func=get_canvas_structure,
        name='get_canvas_structure',
        description=(
            'Получает текущую корпоративную структуру с Канваса '
            '(узлы, связи, юрисдикции) для анализа рисков.'
        ),
        args_schema=GetCanvasStructureInput,
    )

    tool_calculate_tax = StructuredTool.from_function(
        func=calculate_tax_flow,
        name='calculate_tax_flow',
        description=(
            'Вызывает математическое ядро TSM26 (engine-tax) для расчёта '
            'WHT, CIT и ETR при симуляции выплаты.'
        ),
        args_schema=CalculateTaxFlowInput,
    )

    return [tool_get_canvas, tool_calculate_tax]


# ─── RAG Retriever ────────────────────────────────────────────────────────────

def build_retriever():
    """Initialize the ChromaDB RAG retriever."""
    db_path = os.path.abspath(CHROMADB_DIR)
    if not os.path.exists(db_path):
        print(f'  [WARN] ChromaDB not found at {db_path}')
        print('         Run: python3 scripts/index_knowledge_base.py')
        return None

    try:
        from langchain_ollama import OllamaEmbeddings
        embeddings = OllamaEmbeddings(
            model=EMBEDDING_MODEL,
            base_url=OLLAMA_BASE_URL,
        )
        from langchain_community.vectorstores import Chroma
        vectorstore = Chroma(
            persist_directory=db_path,
            collection_name=COLLECTION_NAME,
            embedding_function=embeddings,
        )
        return vectorstore.as_retriever(search_kwargs={'k': 3})
    except Exception as e:
        print(f'  [WARN] Failed to init RAG retriever: {e}')
        return None


# ─── Agent Initialization ─────────────────────────────────────────────────────

def build_agent():
    """Configure the LangChain agent with Ollama LLM + tools + RAG."""
    from langchain_ollama import ChatOllama

    print(f'  LLM: {MODEL_ID} @ {OLLAMA_BASE_URL}')
    llm = ChatOllama(
        model=MODEL_ID,
        base_url=OLLAMA_BASE_URL,
        temperature=0.1,
    )

    tools = build_tools()
    print(f'  Tools bound: {[t.name for t in tools]}')

    retriever = build_retriever()
    if retriever:
        print(f'  RAG retriever: ChromaDB ({COLLECTION_NAME})')
    else:
        print('  RAG retriever: UNAVAILABLE (run index_knowledge_base.py first)')

    # Bind tools to the LLM
    llm_with_tools = llm.bind_tools(tools)

    print(f'\n  Agent initialized successfully.')
    print(f'  Model: {MODEL_ID}')
    print(f'  Tools: {len(tools)} registered')
    print(f'  RAG: {"active" if retriever else "inactive"}')

    return llm_with_tools, tools, retriever


# ─── Verification ─────────────────────────────────────────────────────────────

def verify():
    """Full verification: tools + RAG + agent init."""
    print('=' * 60)
    print('TSM26 Strategy Copilot — Agent Verification')
    print('=' * 60)

    # 1. Build tools
    print('\n[1/3] Registering tools...')
    tools = build_tools()
    for tool in tools:
        schema = tool.args_schema.model_json_schema() if tool.args_schema else {}
        params = list(schema.get('properties', {}).keys())
        print(f'  OK  {tool.name}')
        print(f'       Params: {params}')
        print(f'       Desc: {tool.description[:80]}...')

    # 2. RAG retriever
    print('\n[2/3] Initializing RAG retriever...')
    retriever = build_retriever()
    if retriever:
        docs = retriever.invoke('AIFC CIT exemption')
        print(f'  OK  RAG retriever active — test query returned {len(docs)} docs')
        for i, doc in enumerate(docs):
            print(f'       [{i+1}] {doc.metadata.get("block_id", "?")} — {doc.page_content[:60]}...')
    else:
        print('  SKIP  RAG not indexed yet')

    # 3. Agent init
    print('\n[3/3] Initializing LangChain agent...')
    try:
        llm_with_tools, agent_tools, agent_retriever = build_agent()
        print('\n' + '=' * 60)
        print('VERIFICATION PASSED')
        print('=' * 60)
        print(f'  Tools: {len(agent_tools)} bound')
        for t in agent_tools:
            print(f'    - {t.name}')
        print(f'  RAG:   {"active" if agent_retriever else "inactive"}')
        print(f'  LLM:   {MODEL_ID} (Ollama)')
        return 0
    except Exception as e:
        print(f'\n  [ERROR] Agent init failed: {e}')
        return 1


if __name__ == '__main__':
    sys.exit(verify())
