const char* PAGE_HTML PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>VEXA v1</title>
  <link rel="stylesheet" href="styles.css" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Rajdhani:wght@400;500;600;700&family=Orbitron:wght@400;700;900&display=swap" rel="stylesheet">
</head>
<body>

  <!-- TOPBAR -->
  <header class="topbar">
    <div class="topbar-left">
      <button class="sidebar-toggle" id="sidebarToggle" title="Toggle Sidebar">
        <span></span><span></span><span></span>
      </button>
      <div class="logo">
        <span class="logo-vexa">VEXA v1</span>
        <div class="status-dot" id="statusDot" title="Connection status"></div>
        <span class="status-label" id="statusLabel">DISCONNECTED</span>
      </div>
    </div>
    <div class="topbar-center">
      <button class="global-pause-btn" id="globalPauseBtn" title="Pause / Resume all movement">
        <span class="pause-icon" id="pauseIcon">⏸</span>
        <span class="pause-label" id="pauseLabel">PAUSE</span>
      </button>
    </div>
    <div class="topbar-right">
      <div class="tab-nav">
        <button class="tab-btn active" data-tab="dashboard">DASHBOARD</button>
        <button class="tab-btn" data-tab="programs">PROGRAMS</button>
        <button class="tab-btn" data-tab="terminal">TERMINAL</button>
      </div>
    </div>
  </header>

  <div class="layout">

    <!-- SIDEBAR -->
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-inner">

        <!-- THEME TOGGLE -->
        <section class="panel theme-panel">
          <div class="panel-header">
            <span class="panel-icon">◑</span>
            <h2>THEME</h2>
          </div>
          <div class="theme-toggle-wrap">
            <span class="theme-label" id="themeLabelDark">DARK</span>
            <label class="toggle-switch">
              <input type="checkbox" id="themeToggle" />
              <span class="toggle-track"></span>
            </label>
            <span class="theme-label" id="themeLabelLight">LIGHT</span>
          </div>
        </section>
      </div>
      <div class="sidebar-footer">
        <span class="version-tag">VEXA v0.4.0</span>
      </div>
    </aside>

    <main class="main-content">

      <!-- ══════════════════════════════════════════════
           DASHBOARD
           ══════════════════════════════════════════════ -->
      <div class="tab-content active" id="tab-dashboard">
        <div class="dash-single" id="dashControls">
          <div class="seq-lock-banner" id="seqLockBanner">▶ SEQUENCE RUNNING — MANUAL CONTROLS LOCKED</div>
          <div class="dash-single-inner">

            <div class="section-title">JOINT POSITIONS</div>
            <div class="joint-grid joint-grid-2x3" id="jointGrid"></div>

            <div class="section-title" style="margin-top:1.6rem;">JOINT CONTROL</div>
            <div class="panel">
              <div class="panel-header">
                <span class="panel-icon">⬡</span>
                <h2>JOINTS</h2>
              </div>
              <div class="joint-list joint-list-2x3" id="jointList"></div>
            </div>

            <div class="section-title" style="margin-top:1.6rem;">SAVED POSITIONS</div>
            <div class="panel">
              <div class="panel-header">
                <span class="panel-icon">◈</span>
                <h2>POSITIONS</h2>
              </div>
              <div class="preset-input-row">
                <input type="text" id="presetNameInput" class="text-input" placeholder="Position name..." maxlength="24" />
                <button class="btn btn-accent" id="btnSavePreset">SAVE</button>
              </div>
              <div class="preset-cards-inline" id="presetList"></div>
            </div>

            <div style="margin-top:1.6rem;">
              <div class="section-title">ZERO POSITION</div>
              <div class="panel">
                <div class="panel-header">
                  <span class="panel-icon">↺</span>
                  <h2>ZERO POSITION</h2>
                </div>
                <div class="reset-info" id="resetInfo">Zero = reference pose. All joint angles are relative to it.</div>
                <div class="btn-row">
                  <button class="btn btn-outline" id="btnSetDefault">SET CURRENT AS ZERO</button>
                  <button class="btn btn-danger"  id="btnReset">MOVE TO ZERO</button>
                </div>
              </div>
            </div>

        </div><!-- /dash-single-inner -->
        </div><!-- /dash-single -->
        <div id="presetDashboard" style="display:none;"></div>
      </div><!-- /tab-dashboard -->


      <!-- ══════════════════════════════════════════════
           PROGRAMS
           ══════════════════════════════════════════════ -->
      <div class="tab-content" id="tab-programs">
        <div class="prog-main-row">

          <div class="prog-main-left">
            <div class="section-title">SEQUENCE BUILDER</div>
            <div class="panel">
              <div class="panel-header">
                <span class="panel-icon">▶</span>
                <h2>SEQUENCE</h2>
                <span class="panel-badge" id="stepCount">0 STEPS</span>
              </div>
              <div class="program-add-row">
                <select id="stepPresetSelect" class="text-input select-input">
                  <option value="">— Select position —</option>
                </select>
                <input type="number" id="stepDelay" class="text-input delay-input no-spinner" value="1000" min="100" max="10000" step="100" title="Hold time (ms)" />
                <span class="delay-label">ms</span>
                <button class="btn btn-accent" id="btnAddStep">ADD</button>
              </div>
              <div class="program-list" id="programList">
                <div class="empty-state">No steps yet. Save positions and add them here.</div>
              </div>
              <div class="program-controls">
                <button class="btn btn-run"     id="btnRunProgram"  disabled>▶ RUN</button>
                <button class="btn btn-outline" id="btnStopProgram" disabled>■ STOP</button>
                <button class="btn btn-danger"  id="btnClearProgram">✕ CLEAR ALL</button>
              </div>
              <div class="sequence-save-row">
                <input type="text" id="seqNameInput" class="text-input" placeholder="Sequence name..." maxlength="28" />
                <button class="btn btn-accent" id="btnSaveSeq">SAVE SEQUENCE</button>
              </div>
            </div>
          </div>

          <div class="prog-main-right">

            <div class="section-title">EXECUTION</div>
            <div class="panel">
              <div class="panel-header"><span class="panel-icon">◉</span><h2>STATUS</h2></div>
              <div class="exec-info">
                <div class="exec-row"><span>STATUS</span><span class="exec-val" id="execStatus">IDLE</span></div>
                <div class="exec-row"><span>CURRENT STEP</span><span class="exec-val" id="execStep">—</span></div>
                <div class="exec-row"><span>TOTAL STEPS</span><span class="exec-val" id="execTotal">0</span></div>
                <div class="exec-row">
                  <span>LOOP</span>
                  <label class="toggle-switch">
                    <input type="checkbox" id="loopToggle" />
                    <span class="toggle-track"></span>
                  </label>
                </div>
              </div>
              <div class="progress-bar-wrap">
                <div class="progress-bar" id="progressBar" style="width:0%"></div>
              </div>
            </div>

            <div class="section-title" style="margin-top:1.4rem;">AVAILABLE POSITIONS</div>
            <div class="panel">
              <div class="panel-header"><span class="panel-icon">◈</span><h2>POSITIONS</h2></div>
              <div class="preset-ref-list" id="presetRefList">
                <div class="empty-state">No positions saved.</div>
              </div>
            </div>

            <div class="section-title" style="margin-top:1.4rem;">SAVED SEQUENCES</div>
            <div class="panel">
              <div class="panel-header">
                <span class="panel-icon">💾</span><h2>SEQUENCES</h2>
                <span class="panel-badge" id="seqCount">0</span>
              </div>
              <div class="seq-list" id="seqList">
                <div class="empty-state">No sequences saved.</div>
              </div>
            </div>

          </div>
        </div>
      </div><!-- /tab-programs -->





      <!-- ══════════════════════════════════════════════
           TERMINAL
           ══════════════════════════════════════════════ -->
      <div class="tab-content" id="tab-terminal">
        <div class="single-col">

          <!-- CONNECTION -->
          <div class="section-title">CONNECTION</div>
          <div class="panel">
            <div class="panel-header">
              <span class="panel-icon">⚙</span>
              <h2>ESP32 CONNECTION</h2>
              <span class="conn-live-dot" id="connLiveDot"></span>
              <span class="conn-live-label" id="connLiveLabel">DISCONNECTED</span>
            </div>
            <div class="conn-settings">
              <div class="conn-row">
                <label>Mode</label>
                <select class="text-input select-input" id="connMode">
                  <option value="simulation">Simulation (no hardware)</option>
                  <option value="websocket">WebSocket — ESP32</option>
                  <option value="http">HTTP / fetch()</option>
                </select>
              </div>
              <div class="conn-row" id="connUrlRow" style="display:none">
                <label>ESP32 Address</label>
                <input type="text" class="text-input" id="connUrl" value="ws://vexa.local:81" placeholder="ws://vexa.local:81" />
              </div>
              <div class="conn-hint" id="connHint"></div>
              <div class="conn-actions">
                <button class="btn btn-accent"  id="btnApplyConn">CONNECT</button>
                <button class="btn btn-outline" id="btnPing" disabled>PING</button>
                <button class="btn btn-danger"  id="btnDisconnect" disabled>DISCONNECT</button>
              </div>
            </div>
          </div>

          <!-- TERMINAL LOG -->
          <div class="section-title" style="margin-top:1.8rem;">TERMINAL LOG</div>
          <div class="panel terminal-panel">
            <div class="panel-header">
              <span class="panel-icon">⌨</span>
              <h2>ESP32 LOG</h2>
              <div style="display:flex;gap:0.5rem;margin-left:auto;align-items:center">
                <label class="toggle-switch" title="Auto-scroll">
                  <input type="checkbox" id="autoScrollToggle" checked />
                  <span class="toggle-track"></span>
                </label>
                <span style="font-size:0.7rem;color:var(--text-muted)">AUTO</span>
                <button class="btn btn-outline btn-sm" id="btnClearTerminal">CLEAR</button>
              </div>
            </div>
            <div class="terminal-output" id="terminalOutput">
              <div class="term-line term-info">VEXA v0.4.0 — ready</div>
              <div class="term-line term-info">Select WebSocket and enter ESP32 IP address to connect.</div>
            </div>
            <div class="terminal-input-row">
              <span class="term-prompt">&gt;</span>
              <input type="text" class="terminal-input" id="terminalInput" placeholder="Send command to ESP32  (e.g. home, status, reboot)" />
              <button class="btn btn-accent btn-sm" id="btnSendCmd">SEND</button>
            </div>
          </div>

        </div>
      </div>

    </main>
  </div>

  <div class="toast" id="toast"></div>
  <script src="script.js"></script>
</body>
</html>
)rawliteral";
