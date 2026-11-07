import type { MagpieReply, MagpieState } from '../magpie.ts';
import type { MagpieAppAccess } from './magpie-discovery.ts';

export type MagpieSetupDetection = {
  candidates: { managementUrl: string; gatewayUrl?: string }[];
  gatewayOnly: boolean;
  uncertain: boolean;
};
export type MagpieSetupInputs = {
  savedMode: 'existing' | 'managed' | null;
  savedLocation?: 'local' | 'server';
  savedAccess?: 'manage' | 'use';
  savedUrl?: string;
  invalidSaved: boolean;
  ownedRunning: boolean;
  state: () => Promise<MagpieState>;
  appAccess: () => MagpieAppAccess;
  attach: (access: Extract<MagpieAppAccess, { status: 'available' }>) => Promise<MagpieState>;
  gateway?: () => Promise<MagpieState | undefined>;
  discover: () => Promise<MagpieSetupDetection>;
  available: () => boolean;
  start: () => Promise<MagpieState>;
};

/** Fixed setup procedure. A failed existing connection never implies consent for a second runtime. */
export async function magpieSetup(input: MagpieSetupInputs): Promise<MagpieReply> {
  let state = await input.state();
  const reply = (
    status: 'connected' | 'authorization-required' | 'unavailable',
    message: string,
    reused = false
  ): MagpieReply => ({ state, setup: { status, message, reused } });
  const startOwned = async (): Promise<MagpieReply> => {
    if (!input.available())
      return reply(
        'unavailable',
        'The built-in Magpie runtime is missing. Build it with npm run magpie:build or reinstall Oddboro.'
      );
    try {
      state = await input.start();
      return reply(
        state.ready ? 'connected' : 'unavailable',
        state.ready
          ? 'Oddboro’s built-in Magpie is ready.'
          : 'The built-in Magpie gateway is not ready.'
      );
    } catch {
      state = await input.state();
      return reply(
        'unavailable',
        state.problem || 'The built-in Magpie runtime could not start. Check Models & connections.'
      );
    }
  };
  // A saved choice outranks nearby listeners, including after failure. An outage is
  // not consent to switch instances, downgrade access or create another runtime.
  if (input.invalidSaved)
    return reply(
      'unavailable',
      'The saved Magpie connection cannot be read safely. Connect again in Models & connections.'
    );
  if (state.ready) return reply('connected', 'Magpie is connected.', true);
  if (input.savedAccess === 'use')
    return reply(
      'unavailable',
      state.problem ||
        'Your saved Magpie gateway has no available models. Start it or add models in Magpie, then try again.'
    );
  if (input.savedMode === 'existing' && state.connected && !state.problem)
    return reply(
      'unavailable',
      'Your existing Magpie connection is authorized, but its gateway is not running. Start it in Magpie, then try again.'
    );
  if (input.ownedRunning)
    return reply(
      'unavailable',
      state.problem || 'Oddboro’s Magpie process is still starting. Try again shortly.'
    );
  if (input.savedMode === 'existing' && input.savedLocation === 'server')
    return {
      ...reply(
        'authorization-required',
        'Your Magpie server connection needs authorization. Paste its Browser access link or use the manual connection fields.'
      ),
      candidates: input.savedUrl ? [{ managementUrl: input.savedUrl }] : []
    };
  if (input.savedMode === 'managed') return startOwned();
  // A working public catalog needs no credential read. A refusal may still be paired
  // through the official descriptor, but must never be mistaken for absence.
  let gatewayFailed = false;
  if (input.savedMode === null && input.gateway) {
    try {
      const gateway = await input.gateway();
      if (gateway) {
        state = gateway;
        return reply(
          gateway.ready ? 'connected' : 'unavailable',
          gateway.ready
            ? 'Connected to your existing Magpie gateway. Management authorization is optional.'
            : 'Connected to your existing Magpie gateway, but it has no available models. Add a model in Magpie, then try again.'
        );
      }
    } catch {
      gatewayFailed = true;
    }
  }
  const access = input.appAccess();
  if (access.status === 'available') {
    if (input.savedMode === 'existing' && input.savedUrl !== access.managementUrl)
      return {
        ...reply(
          'authorization-required',
          'The saved Magpie connection is unavailable and another setup was found. Choose the connection you want.'
        ),
        candidates: [
          ...(input.savedUrl ? [{ managementUrl: input.savedUrl }] : []),
          { managementUrl: access.managementUrl }
        ]
      };

    try {
      state = await input.attach(access);
      return reply(
        state.ready ? 'connected' : 'unavailable',
        state.ready
          ? 'Connected to your existing Magpie. Changes here also affect its other clients.'
          : 'Magpie Browser access is connected, but its gateway is not running. Start it in Magpie, then try again.'
      );
    } catch {
      return {
        ...reply(
          'authorization-required',
          'Magpie Browser access did not authorize the connection. Paste its Browser access link or use the manual connection fields.'
        ),
        candidates: [{ managementUrl: access.managementUrl }]
      };
    }
  }
  if (access.status === 'authorization-required')
    return {
      ...reply(
        'authorization-required',
        access.reason === 'disabled'
          ? 'Magpie is configured on this computer. Turn on Browser access in Magpie, then press Magpie again.'
          : 'Magpie Browser access could not be used automatically. Paste its Browser access link or use the manual connection fields.'
      ),
      candidates: access.managementUrl ? [{ managementUrl: access.managementUrl }] : []
    };
  if (gatewayFailed)
    return reply(
      'authorization-required',
      'The local gateway could not provide a verified Magpie catalog. If it requires a key, authorize management in Models & connections; check that its gateway allows local use.'
    );
  const found = await input.discover();
  if (found.candidates.length || found.gatewayOnly || input.savedMode === 'existing') {
    const candidates = [...found.candidates];
    if (
      input.savedMode === 'existing' &&
      input.savedUrl &&
      !candidates.some((c) => c.managementUrl === input.savedUrl)
    )
      candidates.unshift({ managementUrl: input.savedUrl });
    return {
      ...reply(
        'authorization-required',
        found.gatewayOnly
          ? 'Magpie is running. Turn on Browser access in Magpie, then press Magpie again.'
          : 'Your existing Magpie needs one-time authorization. Paste its Browser access link or use the manual connection fields.'
      ),
      candidates
    };
  }
  if (found.uncertain)
    return reply(
      'unavailable',
      'A local service is using a usual Magpie address but could not be identified. Choose the correct connection in Models & connections.'
    );
  return startOwned();
}
