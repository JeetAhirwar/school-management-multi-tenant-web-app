const mongoose = require("mongoose");

const inventorySchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true },
    itemName: { type: String, required: true },
    category: { type: String },
    quantity: { type: Number, required: true },
    reorderLevel: { type: Number, default: 0 },
    unit: { type: String, default: "pcs" },
    supplier: { type: String },
    purchaseDate: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

module.exports = mongoose.model("InventoryItem", inventorySchema);
