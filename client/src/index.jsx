// src/index.js

import React from "react";
import ReactDOM from "react-dom";
import App from "./components/App";
import "./index.css";
import { AuthProvider } from "./context/AuthContext";
import { BrowserRouter as Router } from "react-router-dom";

// ✅ ADD THIS LINE - The Fix for "process is not defined"
window.process = { env: { DEBUG: undefined }, version: '' };

ReactDOM.render(
  <AuthProvider>
    <Router>
      <App />
    </Router>
  </AuthProvider>,
  document.getElementById("root")
);