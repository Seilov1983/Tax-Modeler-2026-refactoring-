import { atom } from 'jotai';
import type { UIMessage } from 'ai';

/** Whether the AI Copilot right panel is open. */
export const copilotOpenAtom = atom(false);

/** Persisted chat history — survives panel unmount/remount. */
export const aiChatHistoryAtom = atom<UIMessage[]>([]);

/** Persisted input draft — survives panel unmount/remount. */
export const aiChatInputAtom = atom('');
