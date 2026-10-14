// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`, SDK v0.14+, Gladys 5.1+).
//
// `refresh_vehicle` reads the car's state from the cloud now (without waking
// the car) and gives it to the next actions of the scene: a scene that runs
// at 7:00 can check the battery before sending a reminder, without waiting
// for the next periodic read.
//
// Fields arrive resolved and validated by the core, without defaults.
// Throwing fails this action only, the scene goes on.
// -----------------------------------------------------------------------------

export const SCENE_ACTION_KEYS = {
  REFRESH_VEHICLE: 'refresh_vehicle',
};

const known = (value) => value !== undefined && value !== null;

export function createSceneActions(runtime) {
  return {
    async [SCENE_ACTION_KEYS.REFRESH_VEHICLE]({ fields }) {
      const snapshot = await runtime.refresh(fields.device);
      const outputs = {};
      if (Number.isFinite(snapshot.batteryLevel)) {
        outputs.battery_level = Math.round(snapshot.batteryLevel);
      }
      if (Number.isFinite(snapshot.fuelLevel)) outputs.fuel_level = Math.round(snapshot.fuelLevel);
      if (Number.isFinite(snapshot.totalRangeKm))
        outputs.range_km = Math.round(snapshot.totalRangeKm);
      if (known(snapshot.plugged)) outputs.plugged = snapshot.plugged;
      if (known(snapshot.charging)) outputs.charging = snapshot.charging;
      if (known(snapshot.locked)) outputs.locked = snapshot.locked;
      return outputs;
    },
  };
}
