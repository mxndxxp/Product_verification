/* eslint-env node */
/* eslint-disable no-undef */
"use strict";

// src/backend/server.js
const express = require("express");
const cors    = require("cors");
const db      = require("./db");

const app  = express();
const PORT = 5000;

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

// ─── ROUTES ───────────────────────────────────────────────────────────────────

/**
 * POST /api/authenticate
 * Body (manual form): { serial, code, mfg }
 * Body (QR scan):     { token }
 */
app.post("/api/authenticate", (req, res) => {
  const { serial, code, mfg, token } = req.body;

  let product = null;

  // ── QR token mode ────────────────────────────────────────────────────────
  if (token) {
    product = db
      .prepare("SELECT * FROM products WHERE token = ?")
      .get(token.trim());

    if (!product) {
      return res.status(200).json({
        success: false,
        alreadyAuthenticated: false,
        message: "Product not found for this QR code.",
      });
    }

  // ── Manual form mode ─────────────────────────────────────────────────────
  } else {
    if (!code || !mfg) {
      return res.status(400).json({
        success: false,
        alreadyAuthenticated: false,
        message: "All fields are required.",
      });
    }

    const isBefore = mfg.trim() !== "03/2022 or after";

    if (isBefore) {
      product = db
        .prepare("SELECT * FROM products WHERE serial = ? AND code = ? AND mfg = ?")
        .get((serial || "").trim(), code.trim(), mfg.trim());
    } else {
      product = db
        .prepare("SELECT * FROM products WHERE code = ? AND mfg = ?")
        .get(code.trim(), mfg.trim());
    }

    if (!product) {
      db.prepare("INSERT INTO auth_logs (serial, authenticated) VALUES (?, 0)")
        .run((serial || "").trim());

      return res.status(200).json({
        success: false,
        alreadyAuthenticated: false,
        message: "Product not found or details incorrect.",
      });
    }
  }

  // ── Check if already authenticated ───────────────────────────────────────
  const prevLog = db
    .prepare(
      "SELECT timestamp FROM auth_logs WHERE serial = ? AND authenticated = 1 ORDER BY timestamp ASC LIMIT 1"
    )
    .get(product.serial);

  if (prevLog) {
    const authDate = new Date(prevLog.timestamp + " UTC");
    const formatted =
      authDate.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
        timeZone: "Asia/Kolkata",
      }) + " IST";

    return res.status(200).json({
      success: false,
      alreadyAuthenticated: true,
      message: "This product has already been authenticated.",
      product: { name: product.name, serial: product.serial },
      firstAuthDate: formatted,
    });
  }

  // ── First time — save and return success ─────────────────────────────────
  db.prepare("INSERT INTO auth_logs (serial, authenticated) VALUES (?, 1)")
    .run(product.serial);

  return res.status(200).json({
    success: true,
    alreadyAuthenticated: false,
    message: "Authentication successful.",
    product: {
      name:   product.name,
      serial: product.serial,
      mfg:    product.mfg,
      token:  product.token,
    },
  });
});

// ── GET /api/products ─────────────────────────────────────────────────────────
app.get("/api/products", (req, res) => {
  const products = db.prepare("SELECT * FROM products").all();
  res.json(products);
});

// ── POST /api/products/add ────────────────────────────────────────────────────
app.post("/api/products/add", (req, res) => {
  const { serial, code, mfg, name, token } = req.body;

  if (!serial || !code || !mfg || !name || !token) {
    return res.status(400).json({ success: false, message: "All fields required." });
  }

  try {
    db.prepare(
      "INSERT INTO products (serial, code, mfg, name, token) VALUES (?, ?, ?, ?, ?)"
    ).run(serial, code, mfg, name, token);

    res.json({ success: true, message: "Product added successfully." });
  } catch (err) {
    if (err.message.includes("UNIQUE")) {
      res.status(409).json({ success: false, message: "Serial number already exists." });
    } else {
      res.status(500).json({ success: false, message: err.message });
    }
  }
});

// ── GET /api/logs ─────────────────────────────────────────────────────────────
app.get("/api/logs", (req, res) => {
  const logs = db
    .prepare("SELECT * FROM auth_logs ORDER BY timestamp DESC")
    .all();
  res.json(logs);
});

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log("🚀 Backend running at http://localhost:" + PORT);
});