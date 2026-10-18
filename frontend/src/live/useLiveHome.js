// Live device states (Device Gateway), agent events and request flows (Event Collector).
import { useEffect, useState } from 'react';
import { collectorWsUrl, gatewayWsUrl, getCollector } from './config';
import { openSocket } from './socket';

const MAX_EVENTS = 300;
const FLOW_LIMIT = 20;

export function useLiveHome(enabled) {
  const [gateway, setGateway] = useState({ status: 'off', haConnected: false, devices: {} });
  const [collector, setCollector] = useState({ status: 'off', events: [] });
  const [flows, setFlows] = useState([]);

  useEffect(() => {
    if (!enabled) {
      setGateway({ status: 'off', haConnected: false, devices: {} });
      return undefined;
    }
    return openSocket(gatewayWsUrl(), {
      onStatus: (status) => setGateway((current) => ({ ...current, status })),
      onMessage: (message) => {
        if (message.type === 'snapshot') {
          const devices = Object.fromEntries(message.devices.map((device) => [device.entity, device]));
          setGateway((current) => ({ ...current, haConnected: message.ha_connected, devices }));
        } else if (message.type === 'device.state_changed') {
          setGateway((current) => ({ ...current, devices: { ...current.devices, [message.device.entity]: message.device } }));
        }
      },
    });
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setCollector({ status: 'off', events: [] });
      setFlows([]);
      return undefined;
    }
    let refresh = null;
    const loadFlows = () => {
      window.clearTimeout(refresh);
      refresh = window.setTimeout(() => {
        getCollector(`/flows?limit=${FLOW_LIMIT}`).then(setFlows).catch(() => {});
      }, 300);
    };
    const close = openSocket(collectorWsUrl(), {
      onStatus: (status) => setCollector((current) => ({ ...current, status })),
      onMessage: (message) => {
        if (message.type === 'snapshot') {
          setCollector((current) => ({ ...current, events: message.events }));
          loadFlows();
        } else if (message.type === 'event') {
          setCollector((current) => ({ ...current, events: [...current.events, message.event].slice(-MAX_EVENTS) }));
          if (message.event.flow) loadFlows();
        }
      },
    });
    return () => {
      window.clearTimeout(refresh);
      close();
    };
  }, [enabled]);

  return { gateway, collector, flows };
}
