'use client';

/**
 * AICopilotChat — Liquid Glass floating chat panel for the Strategy Agent.
 *
 * Uses Vercel AI SDK v5 useChat hook for streaming responses.
 * Positioned bottom-right as a DOM overlay (outside Konva Stage).
 * Context (node ETR, income, risk flags) passed via transport body.
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
import { MessageSquare, X, Send, Sparkles, AlertTriangle } from 'lucide-react';
import { DefaultChatTransport, type UIMessage } from 'ai';

/** Extract concatenated text from UIMessage parts. */
function getMessageText(msg: UIMessage): string {
  return msg.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('');
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
  // We override fetch instead of relying on prepareSendMessagesRequest because
  // the AI SDK may strip non-standard body fields during serialization.
  // This interceptor parses the SDK's serialized body, injects our canvas data,
  // and re-serializes — guaranteeing canvasSnapshot reaches the backend.
  const transportRef = useRef(new DefaultChatTransport({
    api: '/api/chat',
    fetch: (input: RequestInfo | URL, init?: RequestInit) => {
      let body: Record<string, unknown> = {};
      if (init?.body && typeof init.body === 'string') {
        try { body = JSON.parse(init.body); } catch { /* keep empty */ }
      }
      // Inject fresh canvas snapshot from refs (always current at send time)
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
          if (!text) return null;
          return (
            <div
              key={msg.id}
              style={{
                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
              }}
            >
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
