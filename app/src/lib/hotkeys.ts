import { useEffect, useRef } from 'react';

/**
 * Single-key shortcuts, for the parts of the app a pointer reaches faster than
 * a keyboard does.
 *
 * No dependency and no command palette: the app has one shortcut, and a palette
 * is a different feature with a different budget. This only ever sees what
 * reaches the document.
 */

/**
 * Whether the event came from somewhere a keystroke means a character.
 *
 * Exported because a shortcut scoped to a row should be as quiet inside a field
 * as a global one is. `isContentEditable` covers rich text, and the `role`
 * check covers widgets that behave like a field without being one. The
 * `[role=dialog]` test is for modals: a shortcut that fires behind one acts on
 * a screen the reader cannot see.
 */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  if (/^(input|textarea|select)$/i.test(target.tagName)) {
    return true;
  }
  const role = target.getAttribute('role');
  if (role === 'textbox' || role === 'combobox' || role === 'searchbox') {
    return true;
  }
  return target.closest('[role="dialog"], [role="alertdialog"]') != null;
}

/**
 * Run `handler` when `key` is pressed outside a field.
 *
 * Modified presses are left alone — `Ctrl-N` and `Cmd-E` belong to the browser,
 * and stealing them is how a web app earns a reputation. `handler` is read from
 * a ref rather than named in the dependency list so a caller need not memoize
 * it; the listener is attached once per key for the life of the component.
 */
export function useHotkey(key: string, handler: (event: KeyboardEvent) => void, isEnabled = true): void {
  const latest = useRef(handler);
  latest.current = handler;

  useEffect(() => {
    if (!isEnabled || typeof document === 'undefined') {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (event.key !== key) {
        return;
      }
      // Escape is the exception: its whole job is to get you *out* of a field,
      // so it is the one key that must still fire while one has focus.
      if (key !== 'Escape' && isTyping(event.target)) {
        return;
      }
      latest.current(event);
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [key, isEnabled]);
}

/** Focus an element and, when it is a field, select what is in it — so typing replaces. */
export function focusAndSelect(element: HTMLInputElement | HTMLTextAreaElement | null): void {
  if (!element) {
    return;
  }
  element.focus();
  element.select();
}
