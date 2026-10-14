// -----------------------------------------------------------------------------
// Handlers of the Gladys client, in one place so the tests can wire the SDK's
// fake Gladys exactly like index.js wires the real one.
// -----------------------------------------------------------------------------

import { normalizeConfig } from './config.js';
import { createRuntime } from './runtime.js';
import { createWidgets } from './widgets.js';
import { createSceneActions } from './scenes.js';
import { MESSAGES } from './messages.js';

// Manifest actions → runtime method (fields are those of the manifest).
export const ACTION_KEYS = {
  FINISH_SIGN_IN: 'finish_sign_in',
  TEST_CONNECTION: 'test_connection',
  SIGN_OUT: 'sign_out',
};

/**
 * @param {object} options
 * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
 * @param {object} options.store src/store.js
 * @param {object} options.logger
 * @param {object} [options.runtimeOptions] passed to createRuntime (tests: clientFactory, now, timers)
 * @param {string} [options.timeZone] of the widget dates
 * @returns {object} the runtime
 */
export function registerHandlers({ gladys, store, logger, runtimeOptions = {}, timeZone }) {
  const runtime = createRuntime({ gladys, store, logger, ...runtimeOptions });
  let started = false;

  gladys.onScanRequest(() => runtime.scan());
  gladys.onSetValue((device, feature) => runtime.setValue(device, feature));

  // No device is published with `should_poll`: the runtime reads the cloud on
  // its own timer (Gladys 5.2 does not poll reliably, GladysAssistant/Gladys#3198).
  // Kept as a fallback: publishes what changed, never calls the cloud.
  gladys.onPoll((device) => runtime.poll(device));

  // Gladys drops the states of a feature that does not exist yet: send them
  // again now that it does, and let the widget bind to it.
  gladys.onDeviceCreated((device) => runtime.deviceCreated(device));
  gladys.onDeviceUpdated((device) => runtime.deviceCreated(device));

  // The "Connect" button of the account_link field: the brand's sign-in page.
  // Nothing comes back to Gladys: the user pastes the code in an action.
  gladys.onOAuthAuthorizeUrl(() => runtime.signInUrl());

  gladys.onAction(ACTION_KEYS.FINISH_SIGN_IN, (fields) => runtime.finishSignIn(fields?.code));
  gladys.onAction(ACTION_KEYS.TEST_CONNECTION, () => runtime.testConnection());
  gladys.onAction(ACTION_KEYS.SIGN_OUT, () => runtime.signOut());

  for (const [key, handler] of Object.entries(createSceneActions(runtime))) {
    gladys.onSceneAction(key, (fields) => handler({ fields }));
  }

  for (const [key, widget] of Object.entries(createWidgets(runtime, { timeZone }))) {
    gladys.onWidgetGet(key, (request) => widget.get(request));
    gladys.onWidgetAction(key, (actionKey, params, { settings }) =>
      widget.action({ actionKey, params, settings }),
    );
  }

  gladys.onConfigUpdated(async (newConfig) => {
    logger.info('Configuration updated');
    await runtime.reconfigure(normalizeConfig(newConfig));
  });

  gladys.on('connected', async () => {
    try {
      if (!started) {
        started = true;
        await store.load();
        await runtime.start(normalizeConfig(await gladys.getConfig()));
      } else {
        // Reconnected to Gladys: what was published while disconnected was lost.
        await runtime.resync();
      }
    } catch (err) {
      logger.error('Initialization failed', err);
      await runtime.reportStatus(false, MESSAGES.initFailed);
    }
  });

  gladys.handleShutdown(async (signal) => {
    logger.info(`Received ${signal}, stopping`);
    await runtime.stop();
  });

  return runtime;
}
