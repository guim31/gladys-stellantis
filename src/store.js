// -----------------------------------------------------------------------------
// Small JSON persistence under /data, the container's only writable volume.
//
// What survives a restart:
//   - the session of the account: access token, refresh token and their
//     expiry, with the app (brand + country) they belong to: tokens of another
//     app are worthless, they are dropped when the configuration changes;
//   - per car, the optional values it sends (they decide its features) and
//     its last charge status (the "charge finished" trigger survives a restart).
// The file holds tokens: it is written with mode 0600, atomically (temporary
// file + rename), and its content is never logged.
// -----------------------------------------------------------------------------

import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const DEFAULT_DATA_DIR = process.env.DATA_DIR || '/data';
const FILE_NAME = 'stellantis.json';

const emptyData = () => ({ version: 1, session: {}, vehicles: {} });

export function createStore({ dir = DEFAULT_DATA_DIR, debounceMs = 2000, logger } = {}) {
  const file = join(dir, FILE_NAME);
  let data = emptyData();
  let timer = null;
  let writing = Promise.resolve();

  async function load() {
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'));
      if (parsed && parsed.version === 1) data = { ...emptyData(), ...parsed };
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger?.warn(`Ignoring unreadable ${file}: ${err.code ?? 'invalid JSON'}`);
      }
    }
    return data;
  }

  async function flush() {
    clearTimeout(timer);
    timer = null;
    const content = JSON.stringify(data);
    writing = writing.then(async () => {
      try {
        await mkdir(dir, { recursive: true });
        await writeFile(`${file}.tmp`, content, { mode: 0o600 });
        await chmod(`${file}.tmp`, 0o600);
        await rename(`${file}.tmp`, file);
      } catch (err) {
        logger?.warn(`Could not save ${file}: ${err.code ?? err.message}`);
      }
    });
    return writing;
  }

  function touch() {
    if (!timer) {
      timer = setTimeout(flush, debounceMs);
      timer.unref?.();
    }
  }

  return createStoreApi({ get: () => data, touch, flush, load });
}

/** In-memory store with the same API (tests, the probe script). */
export function createMemoryStore(initial = emptyData()) {
  let data = structuredClone(initial);
  return createStoreApi({
    get: () => data,
    touch() {},
    async flush() {},
    async load() {
      data = { ...emptyData(), ...data };
      return data;
    },
  });
}

function createStoreApi({ get, touch, flush, load }) {
  return {
    load,
    flush,
    touch,
    get data() {
      return get();
    },

    /**
     * The session store of the cloud client, bound to the app it belongs to:
     * another app (brand or country changed) starts from an empty session.
     * @param {string} appKey e.g. "peugeot:FR"
     */
    sessionStore(appKey) {
      const data = get();
      if (data.session.app !== appKey) {
        data.session = { app: appKey };
        touch();
      }
      return {
        get: () => get().session,
        set(partial) {
          Object.assign(get().session, partial);
          // A rotated refresh token is saved at once: the previous one is dead.
          flush();
        },
      };
    },

    /** Forget the session (sign-out). */
    clearSession() {
      const data = get();
      data.session = { app: data.session.app };
      return flush();
    },

    /** The memory of one car. */
    vehicle(vin) {
      const data = get();
      data.vehicles[vin] = data.vehicles[vin] ?? {};
      return data.vehicles[vin];
    },
  };
}
