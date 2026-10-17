import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

/**
 * Browser test call to the Retell agent. The backend mints a short-lived access
 * token so the Retell API key never reaches the browser.
 * status: 'idle' | 'connecting' | 'live' | 'error'
 */
export function useWebCall() {
  const clientRef = useRef(null);
  const [status, setStatus] = useState('idle');
  const [agentTalking, setAgentTalking] = useState(false);
  const [error, setError] = useState(null);

  const getClient = useCallback(async () => {
    if (clientRef.current) return clientRef.current;
    // Loaded on demand: the voice SDK is large and most dashboard visits never place a call.
    const { RetellWebClient } = await import('retell-client-js-sdk');
    const client = new RetellWebClient();
    client.on('call_started', () => setStatus('live'));
    client.on('call_ended', () => {
      setStatus('idle');
      setAgentTalking(false);
    });
    client.on('agent_start_talking', () => setAgentTalking(true));
    client.on('agent_stop_talking', () => setAgentTalking(false));
    client.on('error', (err) => {
      setError(err?.message || 'Call error');
      setStatus('error');
      client.stopCall();
    });
    clientRef.current = client;
    return client;
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setStatus('connecting');
    try {
      const { access_token, call_id, transport, ice_servers } = await api.createWebCall();
      const client = await getClient();
      await client.startCall({ accessToken: access_token, callId: call_id, transport, iceServers: ice_servers });
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  }, [getClient]);

  const stop = useCallback(() => {
    clientRef.current?.stopCall();
    setStatus('idle');
    setAgentTalking(false);
  }, []);

  useEffect(() => () => clientRef.current?.stopCall(), []);

  return { status, agentTalking, error, start, stop };
}
