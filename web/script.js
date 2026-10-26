/**
 * VEXA v1 — v0.4.0 (Zero-relative angles)
 * ================================================
 * 1. STATE
 * 2. COMMUNICATION LAYER
 * 3. SMOOTH ANIMATION
 * 4. LOGIC
 * 5. UI RENDERING
 * 6. EVENT BINDING
 */

/* ============================================================
   1. STATE
   ============================================================ */

const JOINTS      = ['J1','J2','J3','J4','J5','J6'];
const JOINT_LABELS = { J1:'BASE', J2:'SHOULDER', J3:'ELBOW', J4:'WRIST-1', J5:'WRIST-2', J6:'TOOL' };
const JOINT_SHORT  = { J1:'BASE', J2:'SHLD',     J3:'ELBW',  J4:'WR1',    J5:'WR2',     J6:'TOOL' };

// Kulmat ovat suhteessa nollapositioon (0° = referenssiasento)
const ANGLE_MIN     = -180;
const ANGLE_MAX     =  180;
const DEFAULT_LIMIT =  90;                // oletusrajat ±90°
const HW_JOINTS     = ['J1','J2','J3'];   // joissa on askelmoottori (ESP32 raportoi todellisen kulman)
const SIM_DPS       = 60;                 // simuloidun animaation nopeus (°/s)

let state = {
  jointAngles:  { J1:0, J2:0, J3:0, J4:0, J5:0, J6:0 },
  displayAngles:{ J1:0, J2:0, J3:0, J4:0, J5:0, J6:0 },
  jointLimits: {
    J1:{min:-90,max:90}, J2:{min:-90,max:90}, J3:{min:-90,max:90},
    J4:{min:-90,max:90}, J5:{min:-90,max:90}, J6:{min:-90,max:90},
  },
  presets:  {},
  program:  [],
  sequences:{},
  programRunning:  false,
  programStopFlag: false,
  globalPaused: false,
  connMode: 'simulation',
  connUrl: '',
  activeWebSocket: null,
  connected: false,
  hwMoving: false,   // ESP32 ilmoittaa onko moottoreita liikkeessä
};

/* ============================================================
   SMOOTH ANIMATION
   ============================================================ */

let _animFrameId = null;
let _animStart   = {};
let _animFrom    = {};
let _animTo      = {};
let _animDur     = {};

function getDegsPerSec() { return SIM_DPS; }

function getDurationForMove(degrees) {
  const dps = getDegsPerSec();
  const dist = Math.abs(degrees);
  if (dist < 0.5) return 30;
  return Math.max(30, Math.round((dist / dps) * 1000));
}

// Kun ESP32 on yhdistetty, askelmoottorinivelten näyttö seuraa todellista kulmaa
function hwDrivesDisplay(joint) {
  return HW_JOINTS.includes(joint) && state.connMode === 'websocket' &&
         state.activeWebSocket?.readyState === WebSocket.OPEN;
}

function applyHwPositions(d) {
  HW_JOINTS.forEach(j => {
    if (typeof d[j] === 'number') {
      delete _animTo[j];
      state.displayAngles[j] = d[j];
      _updateCardDisplay(j);
    }
  });
}

function startSmoothMove(joint, target) {
  if (hwDrivesDisplay(joint)) return;
  const from = state.displayAngles[joint];
  const dist  = Math.abs(target - from);
  _animFrom[joint]  = from;
  _animTo[joint]    = target;
  _animStart[joint] = null;
  _animDur[joint]   = getDurationForMove(dist);
  if (!_animFrameId) _animFrameId = requestAnimationFrame(_animTick);
}

function _animTick(now) {
  let anyActive = false;
  JOINTS.forEach(j => {
    if (_animTo[j] === undefined) return;
    if (_animStart[j] === null) _animStart[j] = now;
    const elapsed = now - _animStart[j];
    const dur = _animDur[j] || 1;
    const t = Math.min(elapsed / dur, 1);

    state.displayAngles[j] = parseFloat((_animFrom[j] + (_animTo[j] - _animFrom[j]) * t).toFixed(1));
    _updateCardDisplay(j);

    if (t < 1) {
      anyActive = true;
    } else {
      state.displayAngles[j] = _animTo[j];
      _updateCardDisplay(j);
      delete _animTo[j]; delete _animFrom[j]; delete _animStart[j]; delete _animDur[j];
    }
  });
  _animFrameId = anyActive ? requestAnimationFrame(_animTick) : null;
}

function _updateCardDisplay(j) {
  const lim = state.jointLimits[j];
  const pct = Math.max(0, Math.min(100, Math.round(((state.displayAngles[j] - lim.min) / (lim.max - lim.min)) * 100)));
  const val = document.getElementById(`jcval-${j}`);
  const bar = document.getElementById(`jcbar-${j}`);
  if (val) val.textContent = fmtDeg(state.displayAngles[j]);
  if (bar) bar.style.width = pct + '%';
}

/* ============================================================
   2. COMMUNICATION LAYER
   ============================================================ */

function sendJointData(data) {
  if (state.globalPaused) return;
  const payload = { timestamp: Date.now(), ...data };

  if (state.connMode === 'simulation') {
    termLog(`TX → ${JSON.stringify(payload)}`, 'send');
  } else if (state.connMode === 'websocket') {
    if (state.activeWebSocket?.readyState === WebSocket.OPEN) {
      state.activeWebSocket.send(JSON.stringify(payload));
      termLog(`TX → ${JSON.stringify(payload)}`,'send');
    } else termLog('WebSocket not connected.','error');
  }
}

/* ============================================================
   3. LOGIC FUNCTIONS
   ============================================================ */

// Käsiohjaukset lukittu kun sekvenssi on käynnissä
function manualLocked() {
  if (state.programRunning) { showToast('Sequence running — manual control locked','error'); return true; }
  return false;
}

function updateJoint(joint, value) {
  if (manualLocked()) return;
  if (state.globalPaused) { showToast('Paused — resume first','error'); return; }
  const lim = state.jointLimits[joint];
  const clamped = Math.max(lim.min, Math.min(lim.max, Number(value)));
  state.jointAngles[joint] = clamped;
  startSmoothMove(joint, clamped);
  sendJointData({ type:'joint_update', joint, angle:clamped, allAngles:{...state.jointAngles} });
  flashCard(joint);
  renderJointSlider(joint);
}

// +/- askelsäätö: yksi painallus kääntää nivelen annetun asteluvun verran
function jogJoint(j, dir) {
  const inp = document.getElementById(`jogstep-${j}`);
  let step = parseFloat(inp ? inp.value : 1);
  if (!isFinite(step) || step <= 0) { step = 1; if (inp) inp.value = 1; }
  const lim = state.jointLimits[j];
  const target = Math.round((state.jointAngles[j] + dir * step) * 100) / 100;
  const clamped = Math.max(lim.min, Math.min(lim.max, target));
  if (clamped === state.jointAngles[j]) { showToast(`${j} at limit`, 'error'); return; }
  updateJoint(j, clamped);
}

function setJointLimits(joint, min, max) {
  if (state.programRunning) return;
  // Rajojen pitää aina sisältää nolla (referenssiasento)
  const lo = Math.max(ANGLE_MIN, Math.min(0, Number(min)));
  const hi = Math.min(ANGLE_MAX, Math.max(0, Number(max), lo + 1));
  state.jointLimits[joint] = { min:lo, max:hi };
  const cur = state.jointAngles[joint];
  const clamped = Math.max(lo, Math.min(hi, cur));
  if (clamped !== cur) updateJoint(joint, clamped);
}

// Nykyinen fyysinen asento julistetaan nollaksi (ESP32 nollaa askelmäärän)
function setZeroHere() {
  if (manualLocked()) return;
  if (state.globalPaused) { showToast('Paused — resume first','error'); return; }
  if (!confirm('Set the current physical pose as ZERO?\nAll joint angles become 0° here. Saved positions keep their numbers but will refer to the new zero.')) return;
  JOINTS.forEach(j => {
    state.jointAngles[j] = 0;
    state.displayAngles[j] = 0;
    delete _animTo[j];
  });
  sendJointData({ type:'custom_cmd', cmd:'zero' });
  renderAllJoints();
  JOINTS.forEach(j => _updateCardDisplay(j));
  showToast('Current pose set as zero','success');
}

function moveToZero() {
  if (manualLocked()) return;
  if (state.globalPaused) { showToast('Paused — resume first','error'); return; }
  JOINTS.forEach(j => { state.jointAngles[j] = 0; startSmoothMove(j, 0); });
  sendJointData({ type:'reset', allAngles:{...state.jointAngles} });
  renderAllJoints();
  showToast('Moving to zero');
}

function savePreset(name) {
  if (!name.trim()) { showToast('Enter a position name','error'); return; }
  const n = name.trim();
  const isUpdate = state.presets.hasOwnProperty(n);
  state.presets[n] = { ...state.jointAngles };
  renderPresetList(); renderProgramPresetSelect(); renderPresetRefList();
  showToast(isUpdate ? `Position "${n}" updated` : `Position "${n}" saved`, 'success');
  return n;
}

function updatePreset(name) {
  if (!state.presets[name]) return;
  if (!confirm(`Overwrite "${name}" with the current position?`)) return;
  state.presets[name] = { ...state.jointAngles };
  renderPresetList(); renderProgramPresetSelect(); renderPresetRefList();
  showToast(`Position "${name}" updated`,'success');
}

function loadPreset(name, fromProgram) {
  if (!state.presets[name]) return;
  if (!fromProgram && manualLocked()) return;
  if (state.globalPaused) { showToast('Paused — resume first','error'); return; }
  const p = state.presets[name];

  JOINTS.forEach(j => { state.jointAngles[j] = p[j]; startSmoothMove(j, p[j]); });
  sendJointData({ type:'preset_load', presetName:name, allAngles:{...state.jointAngles} });
  renderAllJoints();
  showToast(`Position "${name}" loaded`);
}

function renamePreset(oldName, newName) {
  if (!newName || !state.presets[oldName]) return;
  if (state.presets[newName]) { showToast('Name already exists','error'); return; }
  state.presets[newName] = state.presets[oldName];
  delete state.presets[oldName];
  state.program = state.program.map(s => s.presetName===oldName ? {...s,presetName:newName} : s);
  renderPresetList(); renderProgramList(); renderProgramPresetSelect(); renderPresetRefList();
  showToast(`Renamed to "${newName}"`);
}

function deletePreset(name) {
  if (!state.presets[name]) return;
  delete state.presets[name];
  state.program = state.program.filter(s => s.presetName!==name);
  renderPresetList(); renderProgramList(); renderProgramPresetSelect(); renderPresetRefList();
  showToast(`Position "${name}" deleted`);
}

function addProgramStep(presetName, delay) {
  if (!presetName || !state.presets[presetName]) { showToast('Select a valid position','error'); return; }
  state.program.push({ presetName, delay:Number(delay)||1000 });
  renderProgramList(); renderProgramMeta();
  showToast(`Step added: "${presetName}"`);
}

function removeProgramStep(index) { state.program.splice(index,1); renderProgramList(); renderProgramMeta(); }

function moveProgramStep(index, direction) {
  const t = index+direction;
  if (t<0||t>=state.program.length) return;
  [state.program[index],state.program[t]] = [state.program[t],state.program[index]];
  renderProgramList();
}

function clearProgram() { state.program=[]; renderProgramList(); renderProgramMeta(); }

function saveSequence(name) {
  if (!name.trim()) { showToast('Enter a sequence name','error'); return; }
  if (state.program.length===0) { showToast('Sequence is empty','error'); return; }
  const n = name.trim();
  state.sequences[n] = state.program.map(s=>({...s}));
  renderSeqList();
  showToast(`Sequence "${n}" saved`,'success');
  return n;
}

function loadSequence(name) {
  if (!state.sequences[name]) return;
  state.program = state.sequences[name].map(s=>({...s}));
  renderProgramList(); renderProgramMeta();
  showToast(`Sequence "${name}" loaded`);
}

function deleteSequence(name) {
  if (!state.sequences[name]) return;
  delete state.sequences[name];
  renderSeqList();
  showToast(`Sequence "${name}" deleted`);
}

// UUSI AJO-FUNKTIO ASKELMOOTTOREILLE
// Odottaa kunnes ESP32 ilmoittaa moottoreiden pysähtyneen (max 2 min)
async function waitForHardware() {
  await sleep(250); // anna ESP32:n ehtiä raportoida liike
  const t0 = Date.now();
  while (state.hwMoving && !state.programStopFlag &&
         state.activeWebSocket?.readyState === WebSocket.OPEN &&
         Date.now() - t0 < 120000) {
    await sleep(50);
  }
}

async function runProgram() {
  if (state.program.length===0) { showToast('No steps in sequence','error'); return; }
  if (state.programRunning) return;
  state.programRunning=true; state.programStopFlag=false;
  updateRunControls(true); setExecStatus('RUNNING');
  const loop = document.getElementById('loopToggle').checked;

  do {
    for (let i=0; i<state.program.length; i++) {
      if (state.programStopFlag) break;
      while (state.globalPaused && !state.programStopFlag) { setExecStatus('PAUSED'); await sleep(100); }
      if (state.programStopFlag) break;

      setExecStatus('RUNNING');
      const step = state.program[i];
      setExecStep(i+1, state.program.length);
      highlightStep(i);

      // Lasketaan suurimman liikkeen vaatima aika
      const p = state.presets[step.presetName];
      let maxDist = 0;
      if (p) {
        JOINTS.forEach(j => {
          const dist = Math.abs(p[j] - state.jointAngles[j]);
          if (dist > maxDist) maxDist = dist;
        });
      }

      const travelTimeMs = Math.max(30, Math.round((maxDist / getDegsPerSec()) * 1000));

      loadPreset(step.presetName, true);

      // Yhdistettynä: odotetaan oikeaa saapumista, muuten laskettu matka-aika
      if (state.connMode === 'websocket' && state.activeWebSocket?.readyState === WebSocket.OPEN) {
        await waitForHardware();
        if (!state.programStopFlag) await sleep(step.delay);
      } else {
        await sleep(travelTimeMs + step.delay);
      }
    }
    if (state.programStopFlag) break;
  } while (loop && !state.programStopFlag);

  state.programRunning=false; updateRunControls(false); clearHighlights();
  setExecStatus('IDLE'); setExecStep(0,state.program.length); setProgressBar(0);
  if (!state.programStopFlag) showToast('Sequence finished','success');
}

function stopProgram() { state.programStopFlag=true; }

function toggleGlobalPause() {
  state.globalPaused = !state.globalPaused;
  const btn=document.getElementById('globalPauseBtn');
  const icon=document.getElementById('pauseIcon');
  const label=document.getElementById('pauseLabel');
  if (state.globalPaused) {
    btn.classList.add('paused'); icon.textContent='▶'; label.textContent='PAUSED';
    showToast('Movement paused','error');
    if (state.activeWebSocket?.readyState === WebSocket.OPEN) {
      state.activeWebSocket.send(JSON.stringify({ type:'custom_cmd', cmd:'stop', timestamp:Date.now() }));
      termLog('TX → stop','send');
    }
  } else {
    btn.classList.remove('paused'); icon.textContent='⏸'; label.textContent='PAUSE';
    showToast('Movement resumed','success');
  }
}

/* ============================================================
   4. UI RENDERING
   ============================================================ */

function buildJointSidebar() {
  const list = document.getElementById('jointList');
  if (!list) return;
  list.innerHTML = '';
  JOINTS.forEach(j => {
    const wrap = document.createElement('div');
    wrap.className = 'joint-control';
    wrap.id = `jc-${j}`;
    wrap.innerHTML = `
      <div class="joint-header">
        <span class="joint-label">${j} <span>${JOINT_LABELS[j]}</span></span>
        <span class="joint-angle-display" id="jdisp-${j}">${fmtDeg(state.jointAngles[j])}°</span>
      </div>
      <div class="dual-slider-wrap" id="dswrap-${j}">
        <div class="dual-slider-track">
          <div class="dual-slider-range" id="dsrange-${j}"></div>
          <div class="dual-thumb dual-thumb-min" id="dsmin-${j}" title="Min limit"></div>
          <div class="dual-thumb dual-thumb-max" id="dsmax-${j}" title="Max limit"></div>
          <div class="dual-thumb-val" id="dsval-${j}"></div>
        </div>
        <div class="dual-slider-labels">
          <span class="range-label">MIN <span id="dslmin-${j}">${state.jointLimits[j].min}°</span></span>
          <span class="range-label" style="text-align:right">MAX <span id="dslmax-${j}">${state.jointLimits[j].max}°</span></span>
        </div>
      </div>
      <input type="range" class="joint-slider" id="jslider-${j}"
        min="${state.jointLimits[j].min}" max="${state.jointLimits[j].max}" value="${state.jointAngles[j]}"
        style="--pct:${anglePct(j)}%" />
      <div class="jog-row">
        <span class="jog-label">JOG STEP</span>
        <button class="jog-btn" id="jogminus-${j}" title="Jog −">−</button>
        <input type="number" class="jog-input no-spinner" id="jogstep-${j}" value="1" min="0.01" max="180" step="0.5" title="Step size (°)" />
        <span class="jog-unit">°</span>
        <button class="jog-btn" id="jogplus-${j}" title="Jog +">+</button>
      </div>
    `;
    list.appendChild(wrap);
    bindJointEvents(j);
    initDualSlider(j);
  });
}

// UUSI BIND FUNKTIO ASKELMOOTTOREILLE
function bindJointEvents(j) {
  const slider = document.getElementById(`jslider-${j}`);

  // Päivitetään vain graafiikkaa vetäessä, ei lähetetä tietoa ohjaimelle
  slider.addEventListener('input', () => {
    const val = Number(slider.value);
    state.displayAngles[j] = val;
    document.getElementById(`jdisp-${j}`).textContent = fmtDeg(val) + '°';
    slider.style.setProperty('--pct', anglePct(j, val) + '%');
    _updateCardDisplay(j);
  });

  document.getElementById(`jogminus-${j}`).onclick = () => jogJoint(j, -1);
  document.getElementById(`jogplus-${j}`).onclick  = () => jogJoint(j, +1);

  // Kun sliderista päästetään irti, lähetetään lopullinen käsky ESP32:lle
  slider.addEventListener('change', () => {
    updateJoint(j, slider.value);
  });
}

function initDualSlider(j) {
  const wrap     = document.getElementById(`dswrap-${j}`);
  const track    = wrap.querySelector('.dual-slider-track');
  const minThumb = document.getElementById(`dsmin-${j}`);
  const maxThumb = document.getElementById(`dsmax-${j}`);
  const range    = document.getElementById(`dsrange-${j}`);

  function updateVisuals() {
    const lim = state.jointLimits[j];
    const minPct = ((lim.min - ANGLE_MIN) / (ANGLE_MAX - ANGLE_MIN)) * 100;
    const maxPct = ((lim.max - ANGLE_MIN) / (ANGLE_MAX - ANGLE_MIN)) * 100;
    minThumb.style.left = minPct + '%';
    maxThumb.style.left = maxPct + '%';
    if (range) {
      range.style.left  = minPct + '%';
      range.style.width = (maxPct - minPct) + '%';
    }
    const lminEl = document.getElementById(`dslmin-${j}`);
    const lmaxEl = document.getElementById(`dslmax-${j}`);
    if (lminEl) lminEl.textContent = lim.min + '°';
    if (lmaxEl) lmaxEl.textContent = lim.max + '°';
  }

  function makeDraggable(thumb, isMin) {
    function onMove(clientX) {
      const rect = track.getBoundingClientRect();
      const pct  = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const val  = Math.round(ANGLE_MIN + pct * (ANGLE_MAX - ANGLE_MIN));
      const lim  = state.jointLimits[j];
      if (isMin) setJointLimits(j, Math.min(val, lim.max - 1), lim.max);
      else        setJointLimits(j, lim.min, Math.max(val, lim.min + 1));
      updateVisuals();
      updateSliderAttribs(j);
    }

    thumb.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation();
      const move = e2 => onMove(e2.clientX);
      const up   = ()  => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });

    thumb.addEventListener('touchstart', e => {
      e.preventDefault();
      const move = e2 => onMove(e2.touches[0].clientX);
      const up   = ()  => { window.removeEventListener('touchmove', move); window.removeEventListener('touchend', up); };
      window.addEventListener('touchmove', move, { passive: false });
      window.addEventListener('touchend', up);
    }, { passive: false });
  }

  makeDraggable(minThumb, true);
  makeDraggable(maxThumb, false);
  updateVisuals();
}

function renderJointSlider(j) {
  const slider = document.getElementById(`jslider-${j}`);
  const disp   = document.getElementById(`jdisp-${j}`);
  if (!slider) return;
  slider.value = state.jointAngles[j];
  slider.style.setProperty('--pct', anglePct(j)+'%');
  if (disp) disp.textContent = fmtDeg(state.jointAngles[j])+'°';
}

function renderAllJoints() { JOINTS.forEach(j => renderJointSlider(j)); }

function updateSliderAttribs(j) {
  const slider = document.getElementById(`jslider-${j}`);
  if (!slider) return;
  slider.min = state.jointLimits[j].min;
  slider.max = state.jointLimits[j].max;
  renderJointSlider(j);
}

function buildJointCards() {
  const grid = document.getElementById('jointGrid');
  if (!grid) return;
  grid.innerHTML = '';
  JOINTS.forEach(j => {
    const card = document.createElement('div');
    card.className = 'joint-card';
    card.id = `jcard-${j}`;
    card.innerHTML = `
      <div class="joint-card-label">${j} · ${JOINT_LABELS[j]}</div>
      <div class="joint-card-value" id="jcval-${j}">${fmtDeg(state.displayAngles[j])}</div>
      <div class="joint-card-unit">DEG</div>
      <div class="joint-card-bar"><div class="joint-card-bar-fill" id="jcbar-${j}" style="width:${anglePct(j)}%"></div></div>
    `;
    card.addEventListener('click', () => document.getElementById(`jslider-${j}`)?.focus());
    grid.appendChild(card);
  });
}

function flashCard(j) {
  const card = document.getElementById(`jcard-${j}`);
  if (!card) return;
  card.classList.add('updating');
  clearTimeout(card._flashTimer);
  card._flashTimer = setTimeout(() => card.classList.remove('updating'), (_animDur[j]||600)+100);
}

function renderPresetList() {
  const list = document.getElementById('presetList');
  if (!list) return;
  const names = Object.keys(state.presets);
  if (names.length===0) {
    list.innerHTML='<div style="color:var(--text-muted);font-size:0.82rem;padding:0.5rem 0.2rem;grid-column:1/-1">No positions saved.</div>';
    return;
  }
  list.innerHTML='';
  names.forEach(name => {
    const p=state.presets[name];
    const item=document.createElement('div');
    item.className='preset-item';
    const grid=JOINTS.map(j=>`<span><span class="pa-label">${JOINT_SHORT[j]}</span> ${p[j]}°</span>`).join('');
    item.innerHTML=`
      <div class="preset-item-body">
        <div class="preset-name" title="${esc(name)}">${esc(name)}</div>
        <div class="preset-angles-compact">${grid}</div>
        <div class="preset-item-actions">
          <button class="preset-item-btn load">LOAD</button>
          <button class="preset-item-btn upd" title="Overwrite with current position">UPD</button>
          <button class="preset-item-btn ren">REN</button>
          <button class="preset-item-btn del">DEL</button>
        </div>
      </div>`;
    item.querySelector('.load').onclick=()=>loadPreset(name);
    item.querySelector('.upd').onclick=()=>updatePreset(name);
    item.querySelector('.del').onclick=()=>{if(confirm(`Delete position "${name}"?`))deletePreset(name);};
    item.querySelector('.ren').onclick=()=>{const n=prompt('New name:',name);if(n)renamePreset(name,n.trim());};
    list.appendChild(item);
  });
}

function renderProgramPresetSelect() {
  const sel=document.getElementById('stepPresetSelect');
  if (!sel) return;
  const prev=sel.value;
  sel.innerHTML='<option value="">— Select position —</option>';
  Object.keys(state.presets).forEach(name=>{
    const opt=document.createElement('option');
    opt.value=name; opt.textContent=name;
    sel.appendChild(opt);
  });
  if (state.presets[prev]) sel.value=prev;
}

function renderPresetRefList() {
  const el=document.getElementById('presetRefList');
  if (!el) return;
  const names=Object.keys(state.presets);
  if (names.length===0){el.innerHTML='<div class="empty-state">No positions saved.</div>';return;}
  el.innerHTML='';
  names.forEach(name=>{
    const item=document.createElement('div');
    item.className='preset-ref-item';
    const p=state.presets[name];
    item.innerHTML=`<span>${esc(name)}</span><span style="font-family:'Share Tech Mono',monospace;font-size:0.65rem;color:var(--text-muted)">${JOINTS.map(j=>p[j]).join('–')}°</span>`;
    el.appendChild(item);
  });
}

function renderProgramList() {
  const list=document.getElementById('programList');
  const btnRun=document.getElementById('btnRunProgram');
  if (!list) return;
  if (state.program.length===0){
    list.innerHTML='<div class="empty-state">No steps yet. Save positions and add them here.</div>';
    if(btnRun) btnRun.disabled=true; return;
  }
  if(btnRun) btnRun.disabled=false;
  list.innerHTML='';
  state.program.forEach((step,i)=>{
    const item=document.createElement('div');
    item.className='step-item'; item.id=`step-${i}`;
    item.innerHTML=`
      <span class="step-num">${i+1}</span>
      <span class="step-name">${esc(step.presetName)}</span>
      <input type="number" class="step-delay-input no-spinner" value="${step.delay}" min="0" max="10000" step="100" title="Delay (ms)" />
      <span class="step-delay-unit">ms</span>
      <div class="step-actions">
        <button class="step-btn" title="Move up">▲</button>
        <button class="step-btn" title="Move down">▼</button>
        <button class="step-btn" title="Remove" style="color:var(--red)">✕</button>
      </div>`;
    const delayInput=item.querySelector('.step-delay-input');
    delayInput.addEventListener('change',()=>{
      let v=parseInt(delayInput.value);
      if(isNaN(v)||v<0) v=0;
      state.program[i].delay=v;
    });
    delayInput.addEventListener('click',e=>e.stopPropagation());

    const btns=item.querySelectorAll('.step-btn');
    btns[0].onclick=()=>moveProgramStep(i,-1);
    btns[1].onclick=()=>moveProgramStep(i,1);
    btns[2].onclick=()=>removeProgramStep(i);
    list.appendChild(item);
  });
}

function renderProgramMeta() {
  const sc=document.getElementById('stepCount');
  const et=document.getElementById('execTotal');
  if(sc) sc.textContent=`${state.program.length} STEPS`;
  if(et) et.textContent=state.program.length;
}

function renderSeqList() {
  const el=document.getElementById('seqList');
  const cnt=document.getElementById('seqCount');
  if(!el) return;
  const names=Object.keys(state.sequences);
  if(cnt) cnt.textContent=names.length;
  if(names.length===0){el.innerHTML='<div class="empty-state">No sequences saved.</div>';return;}
  el.innerHTML='';
  names.forEach(name=>{
    const seq=state.sequences[name];
    const item=document.createElement('div');
    item.className='seq-item';
    item.innerHTML=`
      <span class="seq-item-name" title="${esc(name)}">${esc(name)}</span>
      <span class="seq-item-meta">${seq.length} steps</span>
      <div class="seq-item-actions">
        <button class="seq-item-btn load">LOAD</button>
        <button class="seq-item-btn del">DEL</button>
      </div>`;
    item.querySelector('.load').onclick=()=>loadSequence(name);
    item.querySelector('.del').onclick=()=>{if(confirm(`Delete sequence "${name}"?`))deleteSequence(name);};
    el.appendChild(item);
  });
}

function setExecStatus(s) {
  const el=document.getElementById('execStatus');
  if(!el) return;
  el.textContent=s;
  el.className='exec-val'+(s==='RUNNING'?' running':s==='PAUSED'?' paused':'');
}

function setExecStep(current, total) {
  const el=document.getElementById('execStep');
  if(el) el.textContent=current?`${current} / ${total}`:'—';
  if(total>0) setProgressBar((current/total)*100);
}

function setProgressBar(pct) {
  const el=document.getElementById('progressBar');
  if(el) el.style.width=pct+'%';
}

function highlightStep(index) {
  document.querySelectorAll('.step-item').forEach(el=>el.classList.remove('running'));
  const el=document.getElementById(`step-${index}`);
  if(el){el.classList.add('running');el.scrollIntoView({block:'nearest',behavior:'smooth'});}
}

function clearHighlights() { document.querySelectorAll('.step-item').forEach(el=>el.classList.remove('running')); }

function updateRunControls(running) {
  const r=document.getElementById('btnRunProgram');
  const s=document.getElementById('btnStopProgram');
  if(r) r.disabled=running;
  if(s) s.disabled=!running;
  // Lukitse dashboardin käsiohjaukset sekvenssin ajaksi
  document.body.classList.toggle('seq-running', running);
  const dash=document.querySelector('.dash-single-inner');
  if(dash) dash.inert=running;
}

function setConnected(isConnected, label) {
  state.connected=isConnected;
  const dot=document.getElementById('statusDot');
  const lbl=document.getElementById('statusLabel');
  if(dot) isConnected?dot.classList.add('connected'):dot.classList.remove('connected');
  if(lbl) lbl.textContent=label||(isConnected?'CONNECTED':'DISCONNECTED');
}

/* ============================================================
   5. EVENT BINDING
   ============================================================ */

function bindEvents() {
  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    if (localStorage.getItem('vexa-theme') === 'light') {
      document.body.classList.add('light-mode');
      themeToggle.checked = true;
    }
    themeToggle.addEventListener('change', () => {
      const isLight = themeToggle.checked;
      document.body.classList.toggle('light-mode', isLight);
      localStorage.setItem('vexa-theme', isLight ? 'light' : 'dark');
    });
  }

  document.getElementById('sidebarToggle').onclick=()=>document.getElementById('sidebar').classList.toggle('collapsed');

  document.querySelectorAll('.tab-btn').forEach(btn=>{
    btn.onclick=()=>{
      document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'));
      btn.classList.add('active');
      const tab=document.getElementById(`tab-${btn.dataset.tab}`);
      if(tab) tab.classList.add('active');
    };
  });

  document.getElementById('globalPauseBtn').onclick=toggleGlobalPause;
  document.getElementById('btnSetDefault').onclick=setZeroHere;
  document.getElementById('btnReset').onclick=moveToZero;

  document.getElementById('btnSavePreset').onclick=()=>{
    const inp=document.getElementById('presetNameInput');
    const n=savePreset(inp.value); if(n) inp.value='';
  };
  document.getElementById('presetNameInput').addEventListener('keydown',e=>{
    if(e.key==='Enter') document.getElementById('btnSavePreset').click();
  });

  document.getElementById('btnAddStep').onclick=()=>addProgramStep(
    document.getElementById('stepPresetSelect').value,
    document.getElementById('stepDelay').value
  );
  document.getElementById('btnRunProgram').onclick=runProgram;
  document.getElementById('btnStopProgram').onclick=stopProgram;
  document.getElementById('btnClearProgram').onclick=()=>{if(confirm('Clear all steps?'))clearProgram();};
  document.getElementById('btnSaveSeq').onclick=()=>{
    const inp=document.getElementById('seqNameInput');
    const n=saveSequence(inp.value); if(n) inp.value='';
  };
  document.getElementById('seqNameInput').addEventListener('keydown',e=>{
    if(e.key==='Enter') document.getElementById('btnSaveSeq').click();
  });

  document.getElementById('btnClearTerminal').onclick=()=>{
    document.getElementById('terminalOutput').innerHTML='<div class="term-line term-info">Terminal cleared.</div>';
  };
  document.getElementById('terminalInput').addEventListener('keydown',e=>{if(e.key==='Enter')sendCustomCommand();});
  document.getElementById('btnSendCmd').onclick=sendCustomCommand;

  document.getElementById('connMode').onchange=e=>{
    state.connMode=e.target.value;
    const isReal=e.target.value!=='simulation';
    document.getElementById('connUrlRow').style.display=isReal?'flex':'none';
    setHint(isReal?'Enter ws://[ESP32 IP]:81':'Simulation mode — no hardware needed','');
  };
  document.getElementById('btnApplyConn').onclick=applyConnection;
  document.getElementById('btnPing').onclick=pingESP32;
  document.getElementById('btnDisconnect').onclick=disconnectESP32;
}

function sendCustomCommand() {
  const inp=document.getElementById('terminalInput');
  const cmd=inp.value.trim(); if(!cmd) return;
  termLog(`CMD: ${cmd}`,'cmd');
  sendJointData({type:'custom_cmd',cmd});
  inp.value='';
}

function applyConnection() {
  const mode = document.getElementById('connMode').value;
  const url  = document.getElementById('connUrl').value.trim();
  state.connMode = mode;
  state.connUrl  = url;
  const hint = document.getElementById('connHint');

  if (mode === 'websocket') {
    if (!url) { setHint('Enter ESP32 address first', 'error'); return; }
    if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
      setHint('Address must start with ws://', 'error'); return;
    }
    if (state.activeWebSocket) {
      state.activeWebSocket.onclose = null;
      state.activeWebSocket.close();
    }
    setHint('Connecting...', '');
    termLog(`Connecting to ${url}...`, 'info');

    try {
      state.activeWebSocket = new WebSocket(url);
      state.activeWebSocket.onopen = () => {
        termLog(`Connected to ESP32 at ${url}`, 'recv');
        setHint(`Connected — ${url}`, 'ok');
        setConnected(true, 'CONNECTED');
        setConnLiveDot(true);
        localStorage.setItem('vexa-ws-url',   url);
        localStorage.setItem('vexa-conn-mode', 'websocket');
        document.getElementById('btnPing').disabled       = false;
        document.getElementById('btnDisconnect').disabled = false;
        document.getElementById('btnApplyConn').disabled  = true;
      };

      state.activeWebSocket.onclose = () => {
        termLog('ESP32 disconnected', 'error');
        setHint('Disconnected', 'error');
        setConnected(false, 'DISCONNECTED');
        setConnLiveDot(false);
        document.getElementById('btnPing').disabled       = true;
        document.getElementById('btnDisconnect').disabled = true;
        document.getElementById('btnApplyConn').disabled  = false;
        state.activeWebSocket = null;
      };

      state.activeWebSocket.onerror = () => {
        termLog('Connection failed — check IP and port', 'error');
        setHint('Connection failed — is ESP32 powered and on same WiFi?', 'error');
      };

      state.activeWebSocket.onmessage = e => {
        try {
          const d = JSON.parse(e.data);
          if (d.moving !== undefined) state.hwMoving = !!d.moving;
          if (d.type === 'hello') {          // yhdistettäessä synkronoidaan nykyiset kulmat
            HW_JOINTS.forEach(j => { if (typeof d[j] === 'number') state.jointAngles[j] = d[j]; });
            renderAllJoints();
          }
          applyHwPositions(d);
          if (d.type === 'moving' || d.type === 'pos') return;   // ei logata joka liikettä
        } catch(err) {}
        termLog(`RX ← ${e.data}`, 'recv');
      };
    } catch(e) {
      termLog(`WebSocket error: ${e.message}`, 'error');
      setHint(`Error: ${e.message}`, 'error');
    }
  } else {
    setConnected(false, 'SIMULATION');
    setConnLiveDot(false);
    setHint('Simulation mode — no hardware needed', '');
    termLog('Simulation mode active', 'info');
    document.getElementById('btnPing').disabled       = true;
    document.getElementById('btnDisconnect').disabled = true;
    document.getElementById('btnApplyConn').disabled  = false;
  }
}

function disconnectESP32() {
  if (state.activeWebSocket) {
    state.activeWebSocket.onclose = null;
    state.activeWebSocket.close();
    state.activeWebSocket = null;
  }
  localStorage.removeItem('vexa-conn-mode');
  setConnected(false, 'DISCONNECTED');
  setConnLiveDot(false);
  setHint('Disconnected', '');
  termLog('Disconnected from ESP32', 'info');
  document.getElementById('btnPing').disabled       = true;
  document.getElementById('btnDisconnect').disabled = true;
  document.getElementById('btnApplyConn').disabled  = false;
  showToast('Disconnected');
}

function pingESP32() {
  if (!state.activeWebSocket || state.activeWebSocket.readyState !== WebSocket.OPEN) {
    showToast('Not connected', 'error'); return;
  }
  const payload = JSON.stringify({ type: 'custom_cmd', cmd: 'status', timestamp: Date.now() });
  state.activeWebSocket.send(payload);
  termLog('TX → ping (status)', 'send');
}

function setHint(msg, type) {
  const el = document.getElementById('connHint');
  if (!el) return;
  el.textContent = msg;
  el.className = 'conn-hint' + (type ? ' ' + type : '');
}

function setConnLiveDot(connected) {
  const dot = document.getElementById('connLiveDot');
  const lbl = document.getElementById('connLiveLabel');
  if (dot) dot.classList.toggle('connected', connected);
  if (lbl) lbl.textContent = connected ? 'CONNECTED' : 'DISCONNECTED';
}

function anglePct(j, v) {
  const lim=state.jointLimits[j];
  const a = (v === undefined) ? state.jointAngles[j] : v;
  return Math.max(0, Math.min(100, Math.round(((a-lim.min)/(lim.max-lim.min))*100)));
}

function fmtDeg(v) {
  const n = parseFloat(v);
  return (n > 0 ? '+' : '') + n.toFixed(1);
}

function esc(str){
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

let _toastTimer;
function showToast(msg,type=''){
  const el=document.getElementById('toast');
  el.textContent=msg; el.className='toast show'+(type?' '+type:'');
  clearTimeout(_toastTimer);
  _toastTimer=setTimeout(()=>el.classList.remove('show'),2600);
}

function termLog(msg,type='info'){
  const out=document.getElementById('terminalOutput');
  if(!out) return;
  const line=document.createElement('div');
  line.className=`term-line term-${type}`;
  line.textContent=`[${new Date().toTimeString().slice(0,8)}] ${msg}`;
  out.appendChild(line);
  const autoScroll=document.getElementById('autoScrollToggle');
  if(!autoScroll||autoScroll.checked) out.scrollTop=out.scrollHeight;
}

function init(){
  buildJointSidebar();
  buildJointCards();
  renderPresetList();
  renderProgramList();
  renderProgramMeta();
  renderSeqList();
  renderProgramPresetSelect();
  renderPresetRefList();
  bindEvents();

  const defaultUrl = (location.protocol === 'http:' && location.hostname)
    ? 'ws://' + location.hostname + ':81' : 'ws://vexa.local:81';
  const savedUrl  = localStorage.getItem('vexa-ws-url')  || defaultUrl;
  // https-sivulta (esim. GitHub Pages) selain estää ws://-yhteydet → vain simulaatio
  const httpsOnly = location.protocol === 'https:';
  const savedMode = httpsOnly ? 'simulation' : (localStorage.getItem('vexa-conn-mode')|| 'simulation');
  document.getElementById('connUrl').value = savedUrl;

  document.getElementById('connUrlRow').style.display='none';
  setConnected(false,'DISCONNECTED');
  setConnLiveDot(false);
  setHint('Simulation mode — no hardware needed','');
  termLog('VEXA v0.4.0 ready','info');

  if (httpsOnly) {
    const modeEl = document.getElementById('connMode');
    if (modeEl) {
      modeEl.querySelectorAll('option').forEach(o => { if (o.value !== 'simulation') o.disabled = true; });
      modeEl.value = 'simulation';
    }
    document.getElementById('btnApplyConn').disabled = true;
    setHint('Simulation only — browsers block ws:// from https pages. To drive the robot, open vexa.local or run web/index.html locally.', 'error');
    termLog('Hardware control disabled on https (simulation only)', 'info');
  }

  if (savedMode === 'websocket') {
    const modeEl = document.getElementById('connMode');
    if (modeEl) {
      modeEl.value = 'websocket';
      state.connMode = 'websocket';
      document.getElementById('connUrlRow').style.display = 'flex';
      setHint('Auto-connecting to ' + savedUrl + '...', '');
      setTimeout(applyConnection, 1000);
    }
  }
}

document.addEventListener('DOMContentLoaded',init);
