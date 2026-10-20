
const mongoose = require("mongoose");

const urlSchema = new mongoose.Schema({
    id: {
        type: Number,
        required: true,
        unique: true
    },
    shortCode: {
        type: String,
        required: true,
        unique: true
    },
    originalUrl: {
        type: String,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    clicks: {
        type: Number,
        default: 0
    }
});

module.exports =
    mongoose.models.Url || mongoose.model("Url", urlSchema);
