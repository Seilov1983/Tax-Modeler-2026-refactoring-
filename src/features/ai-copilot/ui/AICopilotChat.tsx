'use client';

/**
 * AICopilotChat — Liquid Glass floating chat panel for the Strategy Agent.
 *
 * Uses Vercel AI SDK v6 useChat hook for streaming responses.
 * Positioned bottom-right as a DOM overlay (outside Konva Stage).
 * Context (node ETR, income, risk flags) passed via transport body.
 *
 * Tool Invocation UX: when the backend triggers calculate_tax_flow,
 * the SDK streams tool parts to the client. This component intercepts
 * them to show a Liquid Glass pulsing badge during execution, and
 * a formatted result card once the simulation completes.
 *
 * Error resilience: intercepts API errors (401, 429, 502) and displays
 * user-friendly messages inside the chat window without breaking the UI.
 */

import { useChat } from '@ai-sdk/react';
import { useState, useRef, useEffect, useCallback, type FormEvent } from 'react';
import { useAtomValue } from 'jotai';
import { nodesAtom } from '@entities/node';
import { zonesAtom } from '@entities/zone';
import { flowsAtom } from '@entities/flow';
import { projectAtom } from '@features/canvas';
import { generateAuditSnapshot } from '@shared/lib/engine';
import { MessageSquare, X, Send, Sparkles, AlertTriangle, Check } from 'lucide-react';
import { DefaultChatTransport, type UIMessage } from 'ai';

/** Extract concatenated text from UIMessage parts. */
function getMessageText(msg: UIMessage): string {
  return msg.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

// ─── Tool Invocation Detection (AI SDK v6) ────────────────────────────────────
// In v6, tool parts have type 'tool-<name>' with state and result on the part.

interface ToolPart {
  type: string;
  toolCallId: string;
  state: string;
  input: unknown;
  output: unknown;
  toolName: string;
}

/** Extract all tool invocation parts from UIMessage parts. */
function getToolParts(msg: UIMessage): ToolPart[] {
  return msg.parts
    .filter((p) => p.type.startsWith('tool-'))
    .map((p) => ({
      type: p.type,
      toolCallId: (p as any).toolCallId ?? '',
      state: (p as any).state ?? '',
      input: (p as any).input,
      output: (p as any).output,
      toolName: p.type.replace(/^tool-/, ''),
    }));
}

const TOOL_LABELS: Record<string, { active: string; done: string }> = {
  get_canvas_structure: {
    active: '\uD83D\uDD0D \u0410\u043D\u0430\u043B\u0438\u0437 \u0441\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u044B \u043A\u0430\u043D\u0432\u0430\u0441\u0430...',
    done: '\u2705 \u0421\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u0430 \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u0430',
  },
  calculate_tax_flow: {
    active: '\u{1F9EE} \u0421\u0438\u043C\u0443\u043B\u044F\u0446\u0438\u044F \u043D\u0430\u043B\u043E\u0433\u043E\u0432\u044B\u0445 \u043F\u043E\u0442\u043E\u043A\u043E\u0432...',
    done: '\u2705 \u0420\u0430\u0441\u0447\u0451\u0442 \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D',
  },
};

function toolActiveLabel(part: ToolPart): string {
  return TOOL_LABELS[part.toolName]?.active || `\u2699\uFE0F Processing ${part.toolName}...`;
}

function toolDoneLabel(part: ToolPart): string {
  return TOOL_LABELS[part.toolName]?.done || `\u2705 ${part.toolName} done`;
}

/** Format a currency value for display in tool result cards. */
function fmtToolAmount(val: unknown): string {
  if (typeof val !== 'number') return String(val ?? '-');
  return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Map error messages to user-friendly descriptions. */
function friendlyErrorMessage(error: Error | undefined): string | null {
  if (!error) return null;
  const msg = error.message.toLowerCase();

  if (msg.includes('ollama_offline') || msg.includes('econnrefused') || msg.includes('local ai engine')) {
    return 'Local AI Engine is offline. Please start Ollama (run "ollama serve" in terminal).';
  }
  if (msg.includes('fetch') || msg.includes('network') || msg.includes('failed') || msg.includes('503')) {
    return 'Cannot reach the AI engine. Make sure Ollama is running on localhost:11434.';
  }
  if (msg.includes('model') || msg.includes('not found') || msg.includes('404')) {
    return 'AI model not found. Run "ollama pull llama3" to download it.';
  }

  return 'An error occurred with the local AI engine. Please check that Ollama is running.';
}

export function AICopilotChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const nodes = useAtomValue(nodesAtom);
  const zones = useAtomValue(zonesAtom);
  const flows = useAtomValue(flowsAtom);
  const project = useAtomValue(projectAtom);

  // ─── Smart Context Sync: hash-based canvas snapshot ─────────────────────
  const [canvasHash, setCanvasHash] = useState<string | null>(null);
  const snapshotJsonRef = useRef<string>('{}');
  const lastHashRef = useRef<string | null>(null);

  useEffect(() => {
    if (!project) return;
    const timer = setTimeout(async () => {
      try {
        const snapshot = await generateAuditSnapshot(project);
        if (snapshot.hash !== lastHashRef.current) {
          lastHashRef.current = snapshot.hash;
          snapshotJsonRef.current = snapshot.canonicalJson;
          setCanvasHash(snapshot.hash);
        }
      } catch {
        // Snapshot computation is non-critical — fail silently
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [project, nodes, zones, flows]);

  // ─── Transport: custom fetch interceptor injects canvas context ─────────────
  const transportRef = useRef(new DefaultChatTransport({
    api: '/api/chat',
    fetch: (input: RequestInfo | URL, init?: RequestInit) => {
      let body: Record<string, unknown> = {};
      if (init?.body && typeof init.body === 'string') {
        try { body = JSON.parse(init.body); } catch { /* keep empty */ }
      }
      body.canvasSnapshot = snapshotJsonRef.current;
      body.canvasHash = lastHashRef.current;
      return globalThis.fetch(input, {
        ...init,
        body: JSON.stringify(body),
      });
    },
  }));

  const { messages, sendMessage, status, error } = useChat({
    transport: transportRef.current,
    onError: (err) => {
      console.warn('[AICopilot] Chat error:', err.message);
    },
  });

  const isLoading = status === 'streaming' || status === 'submitted';
  const isError = status === 'error';
  const errorText = friendlyErrorMessage(error);

  // Auto-scroll on new messages or error
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isError]);

  const handleFormSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const text = inputValue.trim();
      if (!text || isLoading) return;
      setInputValue('');
      sendMessage({ text });
    },
    [inputValue, isLoading, sendMessage],
  );

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        title="Ask AI Copilot"
        className="fixed bottom-12 right-6 z-50 w-12 h-12 rounded-full bg-white/70 dark:bg-slate-950/70 backdrop-blur-2xl border border-black/5 dark:border-white/5 shadow-[0_8px_32px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.06)] flex items-center justify-center text-indigo-500 cursor-pointer transition-all hover:scale-105 hover:shadow-[0_12px_40px_rgba(0,0,0,0.16),0_4px_12px_rgba(0,0,0,0.08)] active:scale-95"
      >
        <Sparkles size={22} />
      </button>
    );
  }

  return (
    <div
      className="fixed bottom-12 right-6 z-50 w-[380px] h-[520px] flex flex-col bg-white/70 dark:bg-slate-950/70 backdrop-blur-2xl border border-black/5 dark:border-white/5 shadow-2xl rounded-[20px] overflow-hidden"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-black/5 dark:border-white/5 bg-white/40 dark:bg-black/40">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-indigo-500" />
          <span className="text-[14px] font-bold text-slate-800 dark:text-slate-200">
            AI Tax Advisor
          </span>
          {canvasHash && (
            <span
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold shadow-[0_0_8px_rgba(16,185,129,0.15)]"
              title="AI has real-time access to your canvas structure"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.8)]" />
              Canvas synced ({canvasHash.slice(0, 7)})
            </span>
          )}
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="bg-transparent border-none cursor-pointer text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-md transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3"
      >
        {messages.length === 0 && !isError && (
          <div className="text-center text-slate-400 mt-10 text-[13px]">
            <MessageSquare size={28} className="mx-auto mb-3 opacity-40" />
            <p className="m-0 font-bold text-slate-500">Ask about your tax structure</p>
            <p className="mt-2 text-[12px] leading-relaxed">
              I can analyze ETR, CFC risks, WHT optimization, and Pillar 2 exposure for your current model.
            </p>
          </div>
        )}

        {messages.map((msg) => {
          const text = getMessageText(msg);
          const toolParts = getToolParts(msg);
          if (!text && toolParts.length === 0) return null;
          return (
            <div
              key={msg.id}
              style={{
                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
              }}
            >
              {text && (
                <div
                  className={`px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap break-words ${
                    msg.role === 'user' 
                      ? 'rounded-[16px_16px_4px_16px] bg-indigo-500 text-white shadow-md shadow-indigo-500/20' 
                      : 'rounded-[16px_16px_16px_4px] bg-black/5 dark:bg-white/5 text-slate-800 dark:text-slate-200'
                  }`}
                >
                  {text}
                </div>
              )}

              {/* Tool invocation states — Liquid Glass UX */}
              {toolParts.map((part) => {
                const isComplete = part.state === 'output-available';
                const output = part.output as Record<string, unknown> | null;

                if (!isComplete) {
                  // ── Active: Liquid Glass pulsing badge ──────────────
                  return (
                    <div
                      key={part.toolCallId}
                      className="flex items-center gap-2 w-fit px-3 py-1.5 mt-2 text-xs font-medium text-slate-700 bg-white/40 backdrop-blur-md border border-white/50 rounded-full shadow-sm animate-pulse dark:bg-slate-800/50 dark:text-slate-200 dark:border-slate-700/50"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.25" />
                        <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
                        </path>
                      </svg>
                      {toolActiveLabel(part)}
                    </div>
                  );
                }

                // ── Complete: show result card if output has data ───
                if (output && output.success) {
                  return (
                    <div
                      key={part.toolCallId}
                      className="mt-2 px-3 py-2.5 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-500/10 text-[12px] leading-relaxed"
                    >
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Check size={14} className="text-emerald-500" />
                        <span className="font-bold text-slate-800 dark:text-slate-200">
                          {toolDoneLabel(part)}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-slate-700 dark:text-slate-300">
                        {output.grossAmount != null && (
                          <>
                            <span className="text-slate-500 dark:text-slate-400">Gross:</span>
                            <span className="font-bold font-mono">{fmtToolAmount(output.grossAmount)}</span>
                          </>
                        )}
                        {output.whtAmount != null && (
                          <>
                            <span className="text-slate-500 dark:text-slate-400">WHT:</span>
                            <span className="font-bold font-mono text-red-500">-{fmtToolAmount(output.whtAmount)}</span>
                          </>
                        )}
                        {output.citImpact != null && (
                          <>
                            <span className="text-slate-500 dark:text-slate-400">CIT:</span>
                            <span className="font-bold font-mono text-red-500">-{fmtToolAmount(output.citImpact)}</span>
                          </>
                        )}
                        {output.netAfterTax != null && (
                          <>
                            <span className="text-slate-500 dark:text-slate-400">Net:</span>
                            <span className="font-bold font-mono text-emerald-500">{fmtToolAmount(output.netAfterTax)}</span>
                          </>
                        )}
                        {output.effectiveTaxRate != null && (
                          <>
                            <span className="text-slate-500 dark:text-slate-400">ETR:</span>
                            <span className="font-bold">{String(output.effectiveTaxRate)}%</span>
                          </>
                        )}
                        {Boolean(output.dttApplied) && (
                          <>
                            <span className="text-slate-500 dark:text-slate-400">DTT:</span>
                            <span className="font-bold text-indigo-500">
                              Applied (-{fmtToolAmount(output.dttBenefit)})
                            </span>
                          </>
                        )}
                      </div>
                      {Boolean(output.pillarTwoFlag) && (
                        <div className="mt-1.5 px-2 py-1 rounded-md bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                          {String(output.pillarTwoFlag)}
                        </div>
                      )}
                    </div>
                  );
                }

                // Completed but no structured output — subtle checkmark
                return (
                  <div
                    key={part.toolCallId}
                    className="flex items-center gap-2 w-fit px-3 py-1.5 mt-2 text-xs font-medium text-green-700 bg-green-50/40 backdrop-blur-md border border-green-200/50 rounded-full shadow-sm dark:bg-green-900/20 dark:text-green-300 dark:border-green-700/50"
                  >
                    <Check size={12} />
                    {toolDoneLabel(part)}
                  </div>
                );
              })}
            </div>
          );
        })}

        {isLoading && messages[messages.length - 1]?.role === 'user' && (
          <div className="self-start px-3.5 py-2.5 rounded-[16px_16px_16px_4px] bg-black/5 dark:bg-white/5 text-[13px] text-slate-500 animate-pulse">
            Thinking...
          </div>
        )}

        {/* Error banner — Liquid Glass style */}
        {isError && errorText && (
          <div className="self-center flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 max-w-[95%]">
            <AlertTriangle size={16} className="text-red-500 shrink-0 mt-[1px]" />
            <span className="text-[12px] leading-relaxed text-slate-800 dark:text-slate-200">
              {errorText}
            </span>
          </div>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={handleFormSubmit}
        className="flex items-center gap-2 p-3 border-t border-black/5 dark:border-white/5 bg-white/40 dark:bg-black/40"
      >
        <input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Ask about ETR, CFC, WHT..."
          className="flex-1 px-3.5 py-2 text-[13px] border border-black/5 dark:border-white/10 rounded-xl bg-white/50 dark:bg-slate-900/50 outline-none text-slate-800 dark:text-slate-200 transition-colors focus:border-indigo-500/50 focus:bg-white dark:focus:bg-slate-900"
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={isLoading || !inputValue.trim()}
          className={`w-9 h-9 rounded-full border-none flex items-center justify-center transition-all ${
            inputValue.trim()
              ? 'bg-indigo-500 text-white cursor-pointer shadow-md shadow-indigo-500/20 active:scale-95'
              : 'bg-black/5 dark:bg-white/5 text-slate-400 cursor-default'
          }`}
        >
          <Send size={16} className={inputValue.trim() ? "ml-[2px]" : ""} />
        </button>
      </form>
    </div>
  );
}
