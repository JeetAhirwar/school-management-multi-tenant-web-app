const mongoose = require("mongoose");

const stopSchema = new mongoose.Schema({ name: String, time: String }, { _id: false });

const busRouteSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    routeNo: { type: String, required: true },
    driverName: { type: String },
    driverContact: { type: String },
    vehicleNo: { type: String },
    stops: [stopSchema],
    assignedStudents: [{ type: String }],
    currentLocation: {
      lat: { type: Number },
      lng: { type: Number },
      updatedAt: { type: Date },
    },
  },
  { timestamps: true }
);

busRouteSchema.index({ schoolId: 1, routeNo: 1 }, { unique: true });

module.exports = mongoose.model("BusRoute", busRouteSchema);
