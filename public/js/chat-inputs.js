/**
 * chat-inputs.js  v2
 * Shared module: renders interactive input UIs inside the conversational chat.
 * Used by both PreviewEngine (admin) and UserChatEngine (public customer).
 *
 * Validation is performed BOTH real-time (oninput) AND at submit time.
 * All new types expose a single port-out option ID matching the builder's port.
 */

const ChatInputs = (() => {

    /* ═══════════════════════════════════════════════
       UTILITY HELPERS
    ═══════════════════════════════════════════════ */

    const ERR = {
        show(containerId, msg) {
            let el = document.getElementById(`err_${containerId}`);
            if (!el) {
                el = document.createElement('div');
                el.id = `err_${containerId}`;
                el.className = 'chat-input-error';
                document.getElementById(containerId)?.appendChild(el);
            }
            el.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${msg}`;
            el.style.display = 'flex';
        },
        clear(containerId) {
            const el = document.getElementById(`err_${containerId}`);
            if (el) el.style.display = 'none';
        }
    };

    const OK = {
        show(inputEl) {
            inputEl.classList.remove('input-invalid');
            inputEl.classList.add('input-valid');
        },
        clear(inputEl) {
            inputEl.classList.remove('input-valid', 'input-invalid');
        },
        fail(inputEl) {
            inputEl.classList.remove('input-valid');
            inputEl.classList.add('input-invalid');
        }
    };

    function disableContainer(nodeId) {
        const c = document.getElementById(`opts_${nodeId}`);
        if (c) { c.style.pointerEvents = 'none'; c.style.opacity = '0.7'; }
    }

    function submitAnswer(nodeId, engineName, optionId, displayText, branchTitle = '') {
        disableContainer(nodeId);
        ERR.clear(`opts_${nodeId}`);
        window[engineName]?.selectOption(nodeId, optionId, displayText, branchTitle);
    }

    function captureUndoBeforeSubmit(engineName) {
        window[engineName]?.captureUndoState?.();
    }

    /* ═══════════════════════════════════════════════
       MAIN RENDER  — the single entry point
    ═══════════════════════════════════════════════ */

    function render(node, engineRef, engineName) {
        const area = document.getElementById('chatMessagesArea');
        if (!area) return;

        const safe = s => (s || '').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;');
        const safeTitle = safe(node.title);
        let html = '';

        switch (node.type) {

            /* ─── RADIO / CHECKBOX ─── */
            case 'radio':
            case 'checkbox': {
                const pills = (node.options || []).map(opt =>
                    `<button class="chat-option-pill ${opt.color ? 'color-'+opt.color : ''}"
                        onclick="window.${engineName}.selectOption('${safe(node.id)}','${safe(opt.id)}','${safe(opt.text)}','${safeTitle}')"
                    >${opt.text}</button>`
                ).join('');
                html = `<div class="chat-options-container" id="opts_${node.id}">${pills}</div>`;
                break;
            }

            /* ─── DROPDOWN ─── */
            case 'dropdown': {
                const opts = (node.options || []).map(o =>
                    `<option value="${safe(o.id)}">${o.text}</option>`
                ).join('');
                html = `
                <div class="chat-options-container" id="opts_${node.id}">
                    <select class="chat-dropdown"
                        onchange="window.${engineName}.selectOption('${safe(node.id)}',this.value,this.options[this.selectedIndex].text,'${safeTitle}')">
                        <option value="" disabled selected>Select an option…</option>${opts}
                    </select>
                </div>`;
                break;
            }

            /* ─── TEXT ─── */
            case 'text': {
                html = `
                <div class="chat-options-container input-block" id="opts_${node.id}">
                    <div class="input-icon-wrap">
                        <i class="fas fa-pen"></i>
                        <input type="text" class="chat-text-input" id="inp_${node.id}"
                            placeholder="Type your answer…"
                            oninput="ChatInputs._liveText('${node.id}')"
                            onkeydown="if(event.key==='Enter') ChatInputs._submit_text('${node.id}','${engineName}','${safeTitle}')">
                    </div>
                    <div class="chat-input-error" id="err_opts_${node.id}" style="display:none"></div>
                    <button class="btn-send-date" onclick="ChatInputs._submit_text('${node.id}','${engineName}','${safeTitle}')">
                        <i class="fas fa-paper-plane"></i> Send
                    </button>
                </div>`;
                break;
            }

            /* ─── PHONE ─── */
            case 'phone': {
                html = `
                <div class="chat-options-container input-block" id="opts_${node.id}">
                    <div class="input-icon-wrap">
                        <i class="fas fa-phone"></i>
                        <input type="tel" class="chat-text-input" id="inp_${node.id}"
                            placeholder="10-digit mobile number"
                            maxlength="10" inputmode="numeric"
                            oninput="ChatInputs._livePhone(this,'${node.id}')"
                            onkeydown="if(event.key==='Enter') ChatInputs._submit_phone('${node.id}','${engineName}','${safeTitle}')">
                    </div>
                    <div class="phone-digit-counter" id="cnt_${node.id}">0 / 10</div>
                    <div class="chat-input-error" id="err_opts_${node.id}" style="display:none"></div>
                    <button class="btn-send-date" onclick="ChatInputs._submit_phone('${node.id}','${engineName}','${safeTitle}')">
                        <i class="fas fa-paper-plane"></i> Send
                    </button>
                </div>`;
                break;
            }

            /* ─── EMAIL ─── */
            case 'email': {
                html = `
                <div class="chat-options-container input-block" id="opts_${node.id}">
                    <div class="input-icon-wrap">
                        <i class="fas fa-envelope"></i>
                        <input type="email" class="chat-text-input" id="inp_${node.id}"
                            placeholder="your@email.com"
                            oninput="ChatInputs._liveEmail(this,'${node.id}')"
                            onkeydown="if(event.key==='Enter') ChatInputs._submit_email('${node.id}','${engineName}','${safeTitle}')">
                    </div>
                    <div class="chat-input-error" id="err_opts_${node.id}" style="display:none"></div>
                    <button class="btn-send-date" onclick="ChatInputs._submit_email('${node.id}','${engineName}','${safeTitle}')">
                        <i class="fas fa-paper-plane"></i> Send
                    </button>
                </div>`;
                break;
            }

            /* ─── DATE OF BIRTH ─── */
            case 'dob': {
                const todayStr = new Date().toISOString().split('T')[0];
                html = `
                <div class="chat-options-container input-block" id="opts_${node.id}">
                    <label class="date-field-label"><i class="fas fa-birthday-cake"></i> Date of Birth</label>
                    <div class="date-cascade" id="casc_${node.id}">
                        <select class="ymd-select" id="yr_${node.id}"
                            onchange="ChatInputs._cascadeMonth('${node.id}','dob')"
                            title="Select Year">
                            <option value="" disabled selected>— Year —</option>
                            ${_yearOptions(new Date().getFullYear(), 1920)}
                        </select>
                        <select class="ymd-select" id="mo_${node.id}" disabled
                            onchange="ChatInputs._cascadeDay('${node.id}','dob')"
                            title="Select Month">
                            <option value="" disabled selected>— Month —</option>
                        </select>
                        <select class="ymd-select" id="dy_${node.id}" disabled
                            title="Select Day">
                            <option value="" disabled selected>— Day —</option>
                        </select>
                    </div>
                    <div class="chat-input-error" id="err_opts_${node.id}" style="display:none"></div>
                    <button class="btn-send-date" onclick="ChatInputs._submit_dob('${node.id}','${engineName}','${safeTitle}')">
                        <i class="fas fa-check"></i> Confirm Date of Birth
                    </button>
                </div>`;
                break;
            }

            /* ─── DATE RANGE ─── */
            case 'daterange': {
                html = `
                <div class="chat-options-container date-range-block" id="opts_${node.id}">
                    <div class="date-range-section">
                        <label class="date-field-label"><i class="fas fa-calendar-plus"></i> Start Date <span class="required-star">*</span></label>
                        <div class="date-cascade" id="casc_${node.id}_s">
                            <select class="ymd-select" id="yr_${node.id}_s"
                                onchange="ChatInputs._cascadeMonth('${node.id}_s','range')"
                                title="Start Year">
                                <option value="" disabled selected>— Year —</option>
                                ${_yearOptions(new Date().getFullYear() + 10, 1920)}
                            </select>
                            <select class="ymd-select" id="mo_${node.id}_s" disabled
                                onchange="ChatInputs._cascadeDay('${node.id}_s','range')"
                                title="Start Month">
                                <option value="" disabled selected>— Month —</option>
                            </select>
                            <select class="ymd-select" id="dy_${node.id}_s" disabled
                                onchange="ChatInputs._onStartDateChange('${node.id}')"
                                title="Start Day">
                                <option value="" disabled selected>— Day —</option>
                            </select>
                        </div>
                    </div>
                    <div class="date-range-arrow"><i class="fas fa-arrow-right"></i></div>
                    <div class="date-range-section">
                        <label class="date-field-label"><i class="fas fa-calendar-check"></i> End Date <span class="optional-tag">optional</span></label>
                        <div class="date-cascade" id="casc_${node.id}_e">
                            <select class="ymd-select" id="yr_${node.id}_e" disabled
                                onchange="ChatInputs._cascadeMonth('${node.id}_e','range')"
                                title="End Year">
                                <option value="" disabled selected>— Year —</option>
                            </select>
                            <select class="ymd-select" id="mo_${node.id}_e" disabled
                                onchange="ChatInputs._cascadeDay('${node.id}_e','range')"
                                title="End Month">
                                <option value="" disabled selected>— Month —</option>
                            </select>
                            <select class="ymd-select" id="dy_${node.id}_e" disabled
                                title="End Day">
                                <option value="" disabled selected>— Day —</option>
                            </select>
                        </div>
                    </div>
                    <div class="chat-input-error" id="err_opts_${node.id}" style="display:none"></div>
                    <button class="btn-send-date" onclick="ChatInputs._submit_daterange('${node.id}','${engineName}','${safeTitle}')">
                        <i class="fas fa-check"></i> Confirm Dates
                    </button>
                </div>`;
                break;
            }

            /* ─── TIME PICKER ─── */
            case 'time': {
                html = `
                <div class="chat-options-container input-block" id="opts_${node.id}">
                    <label class="date-field-label"><i class="fas fa-clock"></i> Select Time</label>
                    <div class="time-clock-face">
                        <div class="time-display">
                            <input class="time-input-h" id="th_${node.id}" type="number"
                                min="1" max="12" value="12" placeholder="HH"
                                oninput="ChatInputs._clampTime(this,1,12,'${node.id}')">
                            <span class="time-colon">:</span>
                            <input class="time-input-m" id="tm_${node.id}" type="number"
                                min="0" max="59" value="00" placeholder="MM"
                                oninput="ChatInputs._clampTime(this,0,59,'${node.id}')">
                            <div class="ampm-toggle" id="ampm_wrap_${node.id}">
                                <button class="ampm-btn active" id="ampm_${node.id}"
                                    onclick="ChatInputs._toggleAmPm('${node.id}')">AM</button>
                            </div>
                        </div>
                        <div class="time-presets">
                            ${['08:00 AM','09:00 AM','12:00 PM','03:00 PM','06:00 PM','09:00 PM'].map(t => {
                                const [hm, pd] = t.split(' ');
                                const [h, m] = hm.split(':');
                                return `<button class="time-preset-pill" onclick="ChatInputs._setPreset('${node.id}','${h}','${m}','${pd}')">${t}</button>`;
                            }).join('')}
                        </div>
                    </div>
                    <div class="chat-input-error" id="err_opts_${node.id}" style="display:none"></div>
                    <button class="btn-send-date" onclick="ChatInputs._submit_time('${node.id}','${engineName}','${safeTitle}')">
                        <i class="fas fa-check"></i> Confirm Time
                    </button>
                </div>`;
                break;
            }

            default: break;
        }

        if (html) {
            area.insertAdjacentHTML('beforeend', html);
            area.scrollTop = area.scrollHeight;
        }
    }

    /* ═══════════════════════════════════════════════
       YEAR OPTIONS HELPER
    ═══════════════════════════════════════════════ */
    const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const MONTHS_FULL  = ['January','February','March','April','May','June','July','August','September','October','November','December'];

    function _yearOptions(maxYear, minYear) {
        let out = '';
        for (let y = maxYear; y >= minYear; y--) out += `<option value="${y}">${y}</option>`;
        return out;
    }

    /* ═══════════════════════════════════════════════
       CASCADING DATE SELECTS
    ═══════════════════════════════════════════════ */

    function _cascadeMonth(cid, mode) {
        const year = parseInt(document.getElementById(`yr_${cid}`)?.value);
        if (!year) return;
        const moSel = document.getElementById(`mo_${cid}`);
        const dySel = document.getElementById(`dy_${cid}`);

        const today = new Date();
        const maxMonth = (mode === 'dob' && year === today.getFullYear()) ? today.getMonth() : 11;

        moSel.innerHTML = '<option value="" disabled selected>— Month —</option>';
        for (let m = 0; m <= maxMonth; m++) {
            moSel.innerHTML += `<option value="${m}">${MONTHS_FULL[m]}</option>`;
        }
        moSel.disabled = false;

        dySel.innerHTML = '<option value="" disabled selected>— Day —</option>';
        dySel.disabled = true;
    }

    function _cascadeDay(cid, mode) {
        const year  = parseInt(document.getElementById(`yr_${cid}`)?.value);
        const month = parseInt(document.getElementById(`mo_${cid}`)?.value);
        if (isNaN(year) || isNaN(month)) return;

        const today = new Date();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const maxDay = (mode === 'dob' && year === today.getFullYear() && month === today.getMonth())
            ? today.getDate() : daysInMonth;

        const dySel = document.getElementById(`dy_${cid}`);
        dySel.innerHTML = '<option value="" disabled selected>— Day —</option>';
        for (let d = 1; d <= maxDay; d++) dySel.innerHTML += `<option value="${d}">${d}</option>`;
        dySel.disabled = false;
    }

    function _onStartDateChange(nodeId) {
        // Enable the end-date year once a start date is fully chosen
        const sy = document.getElementById(`yr_${nodeId}_s`)?.value;
        const sm = document.getElementById(`mo_${nodeId}_s`)?.value;
        const sd = document.getElementById(`dy_${nodeId}_s`)?.value;
        if (!sy || sm === '' || sm === undefined || !sd) return;

        const endYrSel = document.getElementById(`yr_${nodeId}_e`);
        if (!endYrSel) return;

        // Rebuild end-year options starting from start year
        endYrSel.innerHTML = `<option value="" disabled selected>— Year —</option>`;
        for (let y = new Date().getFullYear() + 10; y >= parseInt(sy); y--) {
            endYrSel.innerHTML += `<option value="${y}">${y}</option>`;
        }
        endYrSel.disabled = false;
        document.getElementById(`mo_${nodeId}_e`).disabled = true;
        document.getElementById(`mo_${nodeId}_e`).innerHTML = '<option value="" disabled selected>— Month —</option>';
        document.getElementById(`dy_${nodeId}_e`).disabled = true;
        document.getElementById(`dy_${nodeId}_e`).innerHTML = '<option value="" disabled selected>— Day —</option>';
    }

    /* ═══════════════════════════════════════════════
       LIVE VALIDATORS
    ═══════════════════════════════════════════════ */

    function _livePhone(input, nodeId) {
        input.value = input.value.replace(/[^0-9]/g, '');
        const len = input.value.length;
        const counter = document.getElementById(`cnt_${nodeId}`);
        if (counter) {
            counter.textContent = `${len} / 10`;
            counter.className = `phone-digit-counter ${len === 10 ? 'counter-ok' : len > 0 ? 'counter-warn' : ''}`;
        }
        if (len > 0 && len < 10) {
            OK.fail(input); ERR.show(`opts_${nodeId}`, `Need ${10 - len} more digit${10 - len > 1 ? 's' : ''}.`);
        } else if (len === 10) {
            OK.show(input); ERR.clear(`opts_${nodeId}`);
        } else {
            OK.clear(input); ERR.clear(`opts_${nodeId}`);
        }
    }

    function _liveEmail(input, nodeId) {
        const val = input.value.trim();
        if (val.length === 0) { OK.clear(input); ERR.clear(`opts_${nodeId}`); return; }
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
            OK.show(input); ERR.clear(`opts_${nodeId}`);
        } else {
            OK.fail(input); ERR.show(`opts_${nodeId}`, 'Enter a valid email (e.g. name@domain.com).');
        }
    }

    function _liveText(nodeId) {
        const val = document.getElementById(`inp_${nodeId}`)?.value.trim();
        if (val) ERR.clear(`opts_${nodeId}`);
    }

    /* ═══════════════════════════════════════════════
       SUBMIT HANDLERS
    ═══════════════════════════════════════════════ */

    function _submit_text(nodeId, engineName, branchTitle) {
        const val = document.getElementById(`inp_${nodeId}`)?.value.trim();
        if (!val) { ERR.show(`opts_${nodeId}`, 'Please type an answer before sending.'); return; }
        captureUndoBeforeSubmit(engineName);
        submitAnswer(nodeId, engineName, 'default_text_opt', val, branchTitle);
    }

    function _submit_phone(nodeId, engineName, branchTitle) {
        const inp = document.getElementById(`inp_${nodeId}`);
        const val = inp?.value.trim();
        if (!val || val.length !== 10) {
            OK.fail(inp);
            ERR.show(`opts_${nodeId}`, 'Phone number must be exactly 10 digits.');
            return;
        }
        OK.show(inp);
        captureUndoBeforeSubmit(engineName);
        submitAnswer(nodeId, engineName, 'phone_input', val, branchTitle);
    }

    function _submit_email(nodeId, engineName, branchTitle) {
        const inp = document.getElementById(`inp_${nodeId}`);
        const val = inp?.value.trim();
        if (!val || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
            OK.fail(inp);
            ERR.show(`opts_${nodeId}`, 'Please enter a valid email address.');
            return;
        }
        OK.show(inp);
        captureUndoBeforeSubmit(engineName);
        submitAnswer(nodeId, engineName, 'email_input', val, branchTitle);
    }

    function _submit_dob(nodeId, engineName, branchTitle) {
        const y = document.getElementById(`yr_${nodeId}`)?.value;
        const m = document.getElementById(`mo_${nodeId}`)?.value;
        const d = document.getElementById(`dy_${nodeId}`)?.value;

        if (!y || m === '' || m === undefined || !d) {
            ERR.show(`opts_${nodeId}`, 'Please select your complete date of birth (Year → Month → Day).'); return;
        }
        const selected = new Date(parseInt(y), parseInt(m), parseInt(d));
        if (selected > new Date()) {
            ERR.show(`opts_${nodeId}`, 'Date of birth cannot be in the future.'); return;
        }
        ERR.clear(`opts_${nodeId}`);
        const display = `${d} ${MONTHS_FULL[parseInt(m)]} ${y}`;
        captureUndoBeforeSubmit(engineName);
        submitAnswer(nodeId, engineName, 'date_input', display, branchTitle);
    }

    function _submit_daterange(nodeId, engineName, branchTitle) {
        const sy = document.getElementById(`yr_${nodeId}_s`)?.value;
        const sm = document.getElementById(`mo_${nodeId}_s`)?.value;
        const sd = document.getElementById(`dy_${nodeId}_s`)?.value;

        if (!sy || sm === '' || sm === undefined || !sd) {
            ERR.show(`opts_${nodeId}`, 'Please select a complete start date.'); return;
        }

        const startDate = new Date(parseInt(sy), parseInt(sm), parseInt(sd));
        let display = `From ${sd} ${MONTHS_FULL[parseInt(sm)]} ${sy}`;

        const ey = document.getElementById(`yr_${nodeId}_e`)?.value;
        const em = document.getElementById(`mo_${nodeId}_e`)?.value;
        const ed = document.getElementById(`dy_${nodeId}_e`)?.value;

        if (ey || (em !== '' && em !== undefined) || ed) {
            // User has touched end date — validate it
            if (!ey || em === '' || em === undefined || !ed) {
                ERR.show(`opts_${nodeId}`, 'End date is incomplete. Either fill it fully or leave it empty.'); return;
            }
            const endDate = new Date(parseInt(ey), parseInt(em), parseInt(ed));
            if (endDate <= startDate) {
                ERR.show(`opts_${nodeId}`, 'End date must be after the start date.'); return;
            }
            display += ` → ${ed} ${MONTHS_FULL[parseInt(em)]} ${ey}`;
        }

        ERR.clear(`opts_${nodeId}`);
        captureUndoBeforeSubmit(engineName);
        submitAnswer(nodeId, engineName, 'daterange_input', display, branchTitle);
    }

    /* ─── TIME HELPERS ─── */
    function _clampTime(input, min, max, nodeId) {
        let v = parseInt(input.value);
        if (isNaN(v)) return;
        if (v < min) { input.value = min; v = min; }
        if (v > max) { input.value = max; v = max; }
        ERR.clear(`opts_${nodeId}`);
    }

    function _toggleAmPm(nodeId) {
        window.previewEngine?.captureUndoState?.();
        const btn = document.getElementById(`ampm_${nodeId}`);
        if (btn.innerText === 'AM') { btn.innerText = 'PM'; btn.classList.remove('active'); }
        else                        { btn.innerText = 'AM'; btn.classList.add('active'); }
    }

    function _setPreset(nodeId, h, m, period) {
        window.previewEngine?.captureUndoState?.();
        document.getElementById(`th_${nodeId}`).value = h;
        document.getElementById(`tm_${nodeId}`).value = m;
        const btn = document.getElementById(`ampm_${nodeId}`);
        btn.innerText = period;
        btn.className = period === 'AM' ? 'ampm-btn active' : 'ampm-btn';
    }

    function _submit_time(nodeId, engineName, branchTitle) {
        const h = parseInt(document.getElementById(`th_${nodeId}`)?.value);
        const m = parseInt(document.getElementById(`tm_${nodeId}`)?.value);
        const period = document.getElementById(`ampm_${nodeId}`)?.innerText || 'AM';

        if (isNaN(h) || isNaN(m) || h < 1 || h > 12 || m < 0 || m > 59) {
            ERR.show(`opts_${nodeId}`, 'Enter a valid time (hours 1–12, minutes 0–59).'); return;
        }
        ERR.clear(`opts_${nodeId}`);
        const display = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')} ${period}`;
        captureUndoBeforeSubmit(engineName);
        submitAnswer(nodeId, engineName, 'time_input', display, branchTitle);
    }

    /* expose everything needed by inline onclick attributes */
    return {
        render,
        _cascadeMonth, _cascadeDay, _onStartDateChange,
        _livePhone, _liveEmail, _liveText,
        _submit_text, _submit_phone, _submit_email,
        _submit_dob, _submit_daterange,
        _clampTime, _toggleAmPm, _setPreset, _submit_time
    };
})();
