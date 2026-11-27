import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import { auth } from '../lib/firebase.ts';
import type { BasketNotificationEvent } from '../types/nexo.ts';

interface UseBasketNotificationsOptions {
  enabled: boolean;
  isDemoMode: boolean;
  onBasketPublished?: (event: BasketNotificationEvent) => void;
}

export function useBasketNotifications({
  enabled,
  isDemoMode,
  onBasketPublished,
}: UseBasketNotificationsOptions) {
  const [latestNotification, setLatestNotification] = useState<BasketNotificationEvent | null>(null);
  const [unreadNotification, setUnreadNotification] = useState<BasketNotificationEvent | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const lastSeenComparisonIdRef = useRef<number | null>(null);
  const onPublishedRef = useRef(onBasketPublished);
  onPublishedRef.current = onBasketPublished;

  const handleIncoming = useCallback((evt: BasketNotificationEvent, showBanner: boolean) => {
    setLatestNotification(evt);
    if (showBanner && lastSeenComparisonIdRef.current !== evt.comparisonId) {
      lastSeenComparisonIdRef.current = evt.comparisonId;
      setUnreadNotification(evt);
      onPublishedRef.current?.(evt);
    } else if (lastSeenComparisonIdRef.current === null) {
      lastSeenComparisonIdRef.current = evt.comparisonId;
    }
  }, []);

  // Poll inicial e fallback periódico caso o WebSocket esteja indisponível
  const checkLatest = useCallback(
    async (showIfChanged: boolean) => {
      if (!enabled) return;
      try {
        const res = await apiFetch<{ notification: BasketNotificationEvent | null }>(
          '/api/baskets/notifications/latest'
        );
        if (res.notification) {
          handleIncoming(res.notification, showIfChanged);
        }
      } catch {
        // Silencioso em fallback
      }
    },
    [enabled, handleIncoming]
  );

  useEffect(() => {
    if (!enabled) return;
    void checkLatest(false);
  }, [enabled, checkLatest]);

  // Listener de eventos locais no Modo Apresentação (Demo Sandbox)
  useEffect(() => {
    if (!enabled || !isDemoMode || typeof window === 'undefined') return;
    const handler = (e: Event) => {
      const custom = e as CustomEvent<BasketNotificationEvent>;
      if (custom.detail?.type === 'basket:published') {
        handleIncoming(custom.detail, true);
      }
    };
    window.addEventListener('nexo:basket-published', handler);
    return () => window.removeEventListener('nexo:basket-published', handler);
  }, [enabled, isDemoMode, handleIncoming]);

  // WebSocket real (/ws/nexo) no modo autenticado com reconexão controlada
  useEffect(() => {
    if (!enabled || isDemoMode || typeof window === 'undefined') {
      setWsConnected(false);
      return;
    }

    let closed = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = async () => {
      if (closed) return;
      try {
        const currentUser = auth?.currentUser;
        if (!currentUser) return;
        const token = await currentUser.getIdToken();
        if (closed || !token) return;

        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${proto}//${window.location.host}/ws/nexo?token=${encodeURIComponent(token)}`;
        ws = new WebSocket(url);

        ws.onopen = () => {
          if (!closed) setWsConnected(true);
        };

        ws.onmessage = (msgEvt) => {
          try {
            const payload = JSON.parse(String(msgEvt.data || '{}'));
            if (payload?.type === 'basket:published') {
              handleIncoming(payload as BasketNotificationEvent, true);
            }
          } catch {
            // Ignora payload malformado
          }
        };

        ws.onclose = () => {
          if (closed) return;
          setWsConnected(false);
          reconnectTimer = setTimeout(() => {
            void connect();
          }, 8000);
        };
      } catch {
        setWsConnected(false);
      }
    };

    void connect();

    return () => {
      closed = true;
      setWsConnected(false);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        ws?.close();
      } catch {
        // Ignore close race
      }
    };
  }, [enabled, isDemoMode, handleIncoming]);

  const dismissUnread = useCallback(() => {
    setUnreadNotification(null);
  }, []);

  return {
    latestNotification,
    unreadNotification,
    wsConnected,
    dismissUnread,
    refreshLatest: () => checkLatest(true),
  };
}
