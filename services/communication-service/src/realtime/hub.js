// In-process fan-out hub for realtime notifications and events. Each
// communication-service instance serves its own connected SSE clients, so an
// in-memory EventEmitter is sufficient for single-instance deployments.
// Channels are keyed per school + user for notifications, and per school +
// event type for broadcast channels (attendance, etc.).
const { EventEmitter } = require("node:events");

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

// ── Per-user channels (notifications) ──────────────────────────────────────
const userKeyFor = (schoolId, userId) => `${String(schoolId)}:${String(userId)}`;

function publish(schoolId, userId, payload) {
  emitter.emit(userKeyFor(schoolId, userId), payload);
}

function subscribe(schoolId, userId, handler) {
  const channel = userKeyFor(schoolId, userId);
  emitter.on(channel, handler);
  return () => emitter.off(channel, handler);
}

// ── School-wide broadcast channels (attendance, fees, etc.) ────────────────
// broadcast(schoolId, event, payload) — emits to every subscriber of
// school:{schoolId}:event:{event}. Subscribers must filter by role/permissions
// on the client side since the server broadcasts to the entire school.
const broadcastKeyFor = (schoolId, event) =>
  `school:${String(schoolId)}:event:${String(event)}`;

function broadcast(schoolId, event, payload) {
  emitter.emit(broadcastKeyFor(schoolId, event), { event, ...payload });
}

function subscribeBroadcast(schoolId, event, handler) {
  const channel = broadcastKeyFor(schoolId, event);
  emitter.on(channel, handler);
  return () => emitter.off(channel, handler);
}

module.exports = { publish, subscribe, broadcast, subscribeBroadcast };