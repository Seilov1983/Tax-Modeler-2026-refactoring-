#!/usr/bin/env python3
"""
TSM26 Strategy Copilot — RAG Knowledge Base Indexer.

Embeds and upserts 5 tax law knowledge chunks into a ChromaDB vector store
using Ollama embeddings (local, zero-config).

ChromaDB is used as the local persistent vector store (Pinecone/Milvus-compatible
interface via LangChain). For production, swap the vectorstore backend by changing
the import and connection string — the Document schema stays identical.

Usage:
    python3 scripts/index_knowledge_base.py
"""

import sys
import os

# ─── ChromaDB persistent path ────────────────────────────────────────────────
PERSIST_DIR = os.path.join(os.path.dirname(__file__), '..', '.chromadb')
COLLECTION_NAME = 'tsm26_knowledge_base'
OLLAMA_BASE_URL = os.environ.get('OLLAMA_BASE_URL', 'http://127.0.0.1:11434')
EMBEDDING_MODEL = os.environ.get('EMBEDDING_MODEL', 'nomic-embed-text')

# ─── 5 Knowledge Chunks (Law-as-Code RAG blocks) ─────────────────────────────

KNOWLEDGE_CHUNKS = [
    {
        'id': 'aifc_exemptions',
        'text': (
            'AIFC (Astana International Financial Centre) participants are exempt '
            'from Corporate Income Tax (CIT) and Value Added Tax (VAT) until '
            'January 1, 2066. This applies to financial and consulting services '
            'rendered within the AIFC jurisdiction. Exemptions require '
            '"Substantial Presence" — the entity must maintain a physical office, '
            'employ qualified staff, and conduct Core Income Generating Activities '
            '(CIGA) within the AIFC zone. Without substantial presence, the '
            'fallback CIT rate of 20% applies (KZ Tax Code Art. 680).'
        ),
        'metadata': {
            'tags': 'AIFC,МФЦА,CIT,VAT,Substance,Exemptions,2066',
            'jurisdiction': 'KZ',
            'zone_code': 'KZ_AIFC',
            'source': 'KZ Tax Code / AIFC Act',
            'block_id': 'block_1_aifc',
        },
    },
    {
        'id': 'astana_hub_cit',
        'text': (
            'Astana Hub IT Park participants receive a 100% reduction of '
            'Corporate Income Tax (CIT) for qualifying ICT activities. '
            'Starting from January 1, 2026, to benefit from this exemption, '
            'companies must provide an extract from the registry of local '
            'producers (Реестр отечественных производителей / Собственное '
            'производство). This ensures only genuine local ICT operations '
            'benefit from the zero-CIT regime. The exemption covers software '
            'development, IT services, data processing, and digital content '
            'creation activities.'
        ),
        'metadata': {
            'tags': 'Astana Hub,IT,CIT,100% reduction,Собственное производство',
            'jurisdiction': 'KZ',
            'zone_code': 'KZ_HUB',
            'source': 'Astana Hub Regulations 2026',
            'block_id': 'block_2_astana_hub',
        },
    },
    {
        'id': 'cfc_rules',
        'text': (
            'Controlled Foreign Corporation (CFC / КИК) rules are triggered when '
            'a Kazakhstan tax resident has ownership or control of >= 25% in a '
            'foreign entity AND the foreign entity\'s Effective Tax Rate (ETR) '
            'is below 10%. When triggered, the CFC\'s undistributed profits are '
            'attributed to the Kazakhstan parent and taxed at the domestic CIT '
            'rate (20%). Safe harbors exist: (1) the foreign jurisdiction has a '
            'Double Tax Treaty (DTT) with Kazakhstan and applies a tax rate of '
            'at least 75% of the KZ domestic rate; (2) passive income '
            '(dividends, interest, royalties) constitutes less than 20% of '
            'total income. Passive income share >= 20% is a CFC red flag.'
        ),
        'metadata': {
            'tags': 'CFC,КИК,Контролируемая иностранная компания,ETR,Пассивный доход',
            'jurisdiction': 'KZ',
            'zone_code': None,
            'source': 'KZ Tax Code Chapter 28',
            'block_id': 'block_3_cfc',
        },
    },
    {
        'id': 'dtt_wht_relief',
        'text': (
            'Double Tax Treaties (DTT / СИДН) provide reduced Withholding Tax '
            '(WHT) rates for ultimate beneficiaries of cross-border payments. '
            'To claim treaty benefits, the recipient must provide a Certificate '
            'of Tax Residency (Сертификат резидентства) from their home '
            'jurisdiction. The certificate must be submitted by March 31 of the '
            'year following the payment, or no later than 5 working days before '
            'a scheduled tax audit — whichever comes first. Without a valid '
            'certificate, the domestic WHT rate applies in full. Treaty shopping '
            'and beneficial ownership tests apply — conduit arrangements may be '
            'denied treaty benefits.'
        ),
        'metadata': {
            'tags': 'DTT,WHT,СИДН,Конвенции,Налог у источника,Сертификат резидентства',
            'jurisdiction': 'INTERNATIONAL',
            'zone_code': None,
            'source': 'OECD Model Tax Convention / KZ Tax Code Art. 667',
            'block_id': 'block_4_dtt',
        },
    },
    {
        'id': 'tsm26_guardrails',
        'text': (
            'TSM26 Platform Guard-rails and Thresholds (2026): '
            '(1) Cash transaction limit: 1000 MRP (Monthly Calculation Index). '
            'Payments exceeding this threshold must be made via bank transfer. '
            '(2) OECD Pillar Two (GloBE / D-MACE): applies to multinational '
            'groups with consolidated revenue exceeding 750 million EUR. If the '
            'group\'s ETR in any jurisdiction falls below 15%, a top-up tax '
            '(Qualified Domestic Minimum Top-up Tax / QDMTT) may apply. '
            '(3) 2026 base personal deduction for individual income tax (PIT) '
            'is set at 30 MRP. These constants are embedded in the TSM26 '
            'engine\'s masterData configuration.'
        ),
        'metadata': {
            'tags': 'TSM26,Limits,D-MACE,Cash Limit,Pillar Two',
            'jurisdiction': 'KZ',
            'zone_code': None,
            'source': 'TSM26 Engine Config / OECD Pillar Two Framework',
            'block_id': 'block_5_guardrails',
        },
    },
]


def check_ollama_embedding_model():
    """Verify the embedding model is available in Ollama."""
    import requests
    try:
        resp = requests.get(f'{OLLAMA_BASE_URL}/api/tags', timeout=5)
        if resp.status_code == 200:
            models = [m['name'] for m in resp.json().get('models', [])]
            # Check both exact match and prefix match (ollama tags include :latest)
            has_model = any(
                EMBEDDING_MODEL in m for m in models
            )
            if not has_model:
                print(f'[WARN] Embedding model "{EMBEDDING_MODEL}" not found in Ollama.')
                print(f'       Available models: {models}')
                print(f'       Pulling {EMBEDDING_MODEL}...')
                pull_resp = requests.post(
                    f'{OLLAMA_BASE_URL}/api/pull',
                    json={'name': EMBEDDING_MODEL, 'stream': False},
                    timeout=300,
                )
                if pull_resp.status_code == 200:
                    print(f'       Successfully pulled {EMBEDDING_MODEL}.')
                else:
                    print(f'[ERROR] Failed to pull model: {pull_resp.text}')
                    return False
            return True
        else:
            print(f'[ERROR] Ollama returned status {resp.status_code}')
            return False
    except requests.ConnectionError:
        print(f'[ERROR] Cannot connect to Ollama at {OLLAMA_BASE_URL}')
        print('       Start Ollama: ollama serve')
        return False


def main():
    print('=' * 60)
    print('TSM26 Strategy Copilot — RAG Knowledge Base Indexer')
    print('=' * 60)

    # 1. Check Ollama is running and has the embedding model
    print(f'\n[1/3] Checking Ollama embedding model ({EMBEDDING_MODEL})...')
    if not check_ollama_embedding_model():
        print('\n[FALLBACK] Using ChromaDB default embeddings (all-MiniLM-L6-v2)')
        use_ollama_embeddings = False
    else:
        print(f'       Ollama OK — using {EMBEDDING_MODEL} for embeddings.')
        use_ollama_embeddings = True

    # 2. Initialize vector store
    print(f'\n[2/3] Initializing ChromaDB at {os.path.abspath(PERSIST_DIR)}...')

    from langchain_core.documents import Document

    documents = []
    ids = []
    for chunk in KNOWLEDGE_CHUNKS:
        doc = Document(
            page_content=chunk['text'],
            metadata=chunk['metadata'],
        )
        documents.append(doc)
        ids.append(chunk['id'])

    if use_ollama_embeddings:
        from langchain_ollama import OllamaEmbeddings
        embeddings = OllamaEmbeddings(
            model=EMBEDDING_MODEL,
            base_url=OLLAMA_BASE_URL,
        )
    else:
        # Fallback: ChromaDB's built-in sentence-transformer embeddings
        embeddings = None

    if embeddings:
        from langchain_community.vectorstores import Chroma
        vectorstore = Chroma.from_documents(
            documents=documents,
            embedding=embeddings,
            persist_directory=PERSIST_DIR,
            collection_name=COLLECTION_NAME,
            ids=ids,
        )
    else:
        # Use ChromaDB directly with default embeddings
        import chromadb
        client = chromadb.PersistentClient(path=PERSIST_DIR)
        collection = client.get_or_create_collection(
            name=COLLECTION_NAME,
        )
        collection.upsert(
            ids=ids,
            documents=[c['text'] for c in KNOWLEDGE_CHUNKS],
            metadatas=[c['metadata'] for c in KNOWLEDGE_CHUNKS],
        )
        vectorstore = None
        print(f'       ChromaDB collection "{COLLECTION_NAME}" created (default embeddings).')

    # 3. Verify ingestion
    print(f'\n[3/3] Verifying ingestion...')

    if vectorstore:
        results = vectorstore.similarity_search('CIT exemption AIFC', k=2)
        print(f'       Vector store: {len(documents)} documents ingested.')
        print(f'       Similarity search test (query: "CIT exemption AIFC"):')
        for i, doc in enumerate(results):
            preview = doc.page_content[:80] + '...'
            print(f'         [{i+1}] {doc.metadata.get("block_id", "?")} — {preview}')
    else:
        import chromadb
        client = chromadb.PersistentClient(path=PERSIST_DIR)
        collection = client.get_collection(name=COLLECTION_NAME)
        count = collection.count()
        results = collection.query(
            query_texts=['CIT exemption AIFC'],
            n_results=2,
        )
        print(f'       ChromaDB collection: {count} documents ingested.')
        print(f'       Similarity search test (query: "CIT exemption AIFC"):')
        for i, (doc_id, text) in enumerate(
            zip(results['ids'][0], results['documents'][0])
        ):
            preview = text[:80] + '...'
            print(f'         [{i+1}] {doc_id} — {preview}')

    print('\n' + '=' * 60)
    print('RAG Knowledge Base indexing COMPLETE.')
    print('=' * 60)
    return 0


if __name__ == '__main__':
    sys.exit(main())
