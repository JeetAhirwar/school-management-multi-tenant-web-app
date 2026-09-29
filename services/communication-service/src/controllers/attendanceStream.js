const { subscribeBroadcast } = require("../realtime/hub");

// SSE stream for attendance events within a school. Any authenticated user
// in the school can connect — the client is responsible for filtering by
// role/permissions (e.g. a student should ignore events for other students).
// Heartbeats keep the connection alive through the gateway proxy timeout.
const streamAttendance = (req, res) => {
  const isSuperAdmin = req.user?.role === "super_admin";
  if (!req.tenantId && !isSuperAdmin) {
    return res
      .status(400)
      .json({ success: false, message: "No school context for this request" });
  }

  res.status(200);
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write(`retry: 3000\n\n`);

  const schoolId = req.tenantId || "platform";

  const unsubscribe = subscribeBroadcast(schoolId, "attendance.updated", (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  });

  // Gateway proxy timeout is 10s by default; a comment every 5s is pure idle
  // filler that keeps the socket alive without reaching the SSE parser.
  const heartbeat = setInterval(() => res.write(": hb\n\n"), 5000);

  const cleanup = () => {
    clearInterval(heartbeat);
    unsubscribe();
  };
  req.on("close", cleanup);
  res.on("close", cleanup);
};

// [INTERNAL] Service-to-service push for attendance events. Called by the
// academic-service after markAttendance succeeds. Publishes to the school-wide
// broadcast channel so all connected SSE clients receive the event.
const pushAttendanceEvent = (req, res) => {
  try {
    const { broadcast } = require("../realtime/hub");
    const { schoolId, class: classLabel, section, date, records, markedBy } = req.body;
    if (!schoolId || !classLabel || !date || !Array.isArray(records) || records.length === 0) {
      return res.status(400).json({
        success: false,
        message: "schoolId, class, date, and records array are required",
      });
    }
    broadcast(schoolId, "attendance.updated", {
      schoolId,
      class: classLabel,
      section: section || null,
      date,
      records,
      markedBy: markedBy || null,
      timestamp: new Date().toISOString(),
    });
    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { streamAttendance, pushAttendanceEvent };
