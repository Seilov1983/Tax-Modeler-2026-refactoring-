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
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: 50,
          width: '48px',
          height: '48px',
          borderRadius: '50%',
          background: 'rgba(255, 255, 255, 0.70)',
          backdropFilter: 'blur(40px) saturate(180%)',
          WebkitBackdropFilter: 'blur(40px) saturate(180%)',
          border: '1px solid rgba(255, 255, 255, 0.50)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#007aff',
          transition: 'transform 0.15s, box-shadow 0.15s',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'scale(1.08)';
          e.currentTarget.style.boxShadow = '0 12px 40px rgba(0,0,0,0.16), 0 4px 12px rgba(0,0,0,0.08)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'scale(1)';
          e.currentTarget.style.boxShadow = '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)';
        }}
      >
        <Sparkles size={22} />
      </button>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        zIndex: 50,
        width: '380px',
        height: '520px',
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(255, 255, 255, 0.70)',
        backdropFilter: 'blur(40px) saturate(180%)',
        WebkitBackdropFilter: 'blur(40px) saturate(180%)',
        borderRadius: '20px',
        border: '1px solid rgba(255, 255, 255, 0.50)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', sans-serif",
        overflow: 'hidden',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 16px',
          borderBottom: '1px solid rgba(0,0,0,0.06)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Sparkles size={16} style={{ color: '#007aff' }} />
          <span style={{ fontSize: '14px', fontWeight: 600, color: '#1d1d1f' }}>
            AI Tax Advisor
          </span>
          {canvasHash && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '11px',
                padding: '2px 8px',
                borderRadius: '9999px',
                background: 'rgba(52, 199, 89, 0.12)',
                border: '1px solid rgba(52, 199, 89, 0.3)',
                color: '#34c759',
                boxShadow: '0 0 8px rgba(52, 199, 89, 0.25)',
              }}
              title="AI has real-time access to your canvas structure"
            >
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#34c759', boxShadow: '0 0 4px #34c759' }} />
              Canvas synced ({canvasHash.slice(0, 7)})
            </span>
          )}
        </div>
        <button
          onClick={() => setIsOpen(false)}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: '#86868b',
            padding: '4px',
            display: 'flex',
            borderRadius: '6px',
          }}
        >
          <X size={16} />
        </button>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        {messages.length === 0 && !isError && (
          <div style={{ textAlign: 'center', color: '#86868b', fontSize: '13px', marginTop: '40px' }}>
            <MessageSquare size={28} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
            <p style={{ margin: 0, fontWeight: 500 }}>Ask about your tax structure</p>
            <p style={{ margin: '6px 0 0', fontSize: '12px', lineHeight: 1.4 }}>
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
                  style={{
                    padding: '10px 14px',
                    borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                    background: msg.role === 'user'
                      ? '#007aff'
                      : 'rgba(0, 0, 0, 0.04)',
                    color: msg.role === 'user' ? '#fff' : '#1d1d1f',
                    fontSize: '13px',
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
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
                      <span
                        style={{
                          display: 'inline-block',
                          animation: 'spin 1s linear infinite',
                          fontSize: '14px',
                          lineHeight: 1,
                        }}
                      >
                        {'\u{1F9EE}'}
                      </span>
                      {toolActiveLabel(part)}
                    </div>
                  );
                }

                // ── Complete: show result card if output has data ───
                if (output && output.success) {
                  return (
                    <div
                      key={part.toolCallId}
                      style={{
                        marginTop: '8px',
                        padding: '10px 12px',
                        borderRadius: '12px',
                        background: 'rgba(59, 130, 246, 0.06)',
                        border: '1px solid rgba(59, 130, 246, 0.15)',
                        fontSize: '12px',
                        lineHeight: 1.6,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                        <Check size={14} style={{ color: '#22c55e' }} />
                        <span style={{ fontWeight: 600, color: '#1d1d1f' }}>
                          {toolDoneLabel(part)}
                        </span>
                      </div>
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: '4px 12px',
                        color: '#374151',
                      }}>
                        {output.grossAmount != null && (
                          <>
                            <span style={{ color: '#6b7280' }}>Gross:</span>
                            <span style={{ fontWeight: 600 }}>{fmtToolAmount(output.grossAmount)}</span>
                          </>
                        )}
                        {output.whtAmount != null && (
                          <>
                            <span style={{ color: '#6b7280' }}>WHT:</span>
                            <span style={{ fontWeight: 600, color: '#dc2626' }}>-{fmtToolAmount(output.whtAmount)}</span>
                          </>
                        )}
                        {output.citImpact != null && (
                          <>
                            <span style={{ color: '#6b7280' }}>CIT:</span>
                            <span style={{ fontWeight: 600, color: '#dc2626' }}>-{fmtToolAmount(output.citImpact)}</span>
                          </>
                        )}
                        {output.netAfterTax != null && (
                          <>
                            <span style={{ color: '#6b7280' }}>Net:</span>
                            <span style={{ fontWeight: 600, color: '#16a34a' }}>{fmtToolAmount(output.netAfterTax)}</span>
                          </>
                        )}
                        {output.effectiveTaxRate != null && (
                          <>
                            <span style={{ color: '#6b7280' }}>ETR:</span>
                            <span style={{ fontWeight: 600 }}>{String(output.effectiveTaxRate)}%</span>
                          </>
                        )}
                        {Boolean(output.dttApplied) && (
                          <>
                            <span style={{ color: '#6b7280' }}>DTT:</span>
                            <span style={{ fontWeight: 600, color: '#2563eb' }}>
                              Applied (-{fmtToolAmount(output.dttBenefit)})
                            </span>
                          </>
                        )}
                      </div>
                      {Boolean(output.pillarTwoFlag) && (
                        <div style={{
                          marginTop: '6px',
                          padding: '4px 8px',
                          borderRadius: '6px',
                          background: 'rgba(245, 158, 11, 0.1)',
                          border: '1px solid rgba(245, 158, 11, 0.2)',
                          fontSize: '11px',
                          color: '#92400e',
                          fontWeight: 500,
                        }}>
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
          <div
            style={{
              alignSelf: 'flex-start',
              padding: '10px 14px',
              borderRadius: '16px 16px 16px 4px',
              background: 'rgba(0, 0, 0, 0.04)',
              fontSize: '13px',
              color: '#86868b',
            }}
          >
            Thinking...
          </div>
        )}

        {/* Error banner — Liquid Glass style */}
        {isError && errorText && (
          <div
            style={{
              alignSelf: 'center',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
              padding: '12px 14px',
              borderRadius: '14px',
              background: 'rgba(255, 59, 48, 0.06)',
              border: '1px solid rgba(255, 59, 48, 0.15)',
              maxWidth: '95%',
            }}
          >
            <AlertTriangle size={16} style={{ color: '#ff3b30', flexShrink: 0, marginTop: '1px' }} />
            <span style={{ fontSize: '12px', lineHeight: 1.5, color: '#1d1d1f' }}>
              {errorText}
            </span>
          </div>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={handleFormSubmit}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '12px 16px',
          borderTop: '1px solid rgba(0,0,0,0.06)',
        }}
      >
        <input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Ask about ETR, CFC, WHT..."
          style={{
            flex: 1,
            padding: '10px 14px',
            fontSize: '13px',
            border: '1px solid rgba(0,0,0,0.08)',
            borderRadius: '12px',
            background: 'rgba(255,255,255,0.6)',
            outline: 'none',
            color: '#1d1d1f',
          }}
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={isLoading || !inputValue.trim()}
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            background: inputValue.trim() ? '#007aff' : 'rgba(0,0,0,0.04)',
            border: 'none',
            cursor: inputValue.trim() ? 'pointer' : 'default',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: inputValue.trim() ? '#fff' : '#86868b',
            transition: 'background 0.15s',
          }}
        >
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
