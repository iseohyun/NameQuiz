/**
 * @file components/keybind-manager.js
 * @description 단축키 설정 UI 렌더링, 중복 검증, 배지 갱신 및 전역 키보드 이벤트 매핑 모듈
 */

const MAIN_KEYS = [
  'toggleDomain', 'toggleQuizDirection', 'popupProgress', 'popupSetting',
  'popupLeaderboard', 'popupHelp', 'popupLogin', 'startStudy', 'startRecord', 'startSpectator'
];
const INGAME_KEYS = ['pauseResume', 'option0', 'option1', 'option2', 'option3'];

function formatKeyLabel(rawKey) {
  if (!rawKey) return '-';
  if (rawKey === ' ' || rawKey.toLowerCase() === 'space') return 'Space';
  if (rawKey.toLowerCase() === 'escape') return 'ESC';
  return rawKey.length === 1 ? rawKey.toUpperCase() : rawKey;
}

export function generateKeybindingsHtml(userConfig) {
  const renderRows = (keys) => keys.map((k) => {
    const bind = userConfig.keybindings[k] || { label: k, primary: '', secondary: '' };
    return `
      <tr class="kb-table-row">
        <td class="kb-label-cell">${bind.label}</td>
        <td class="kb-btn-cell">
          <button type="button" class="kb-bind-btn" data-action="${k}" data-type="primary">${formatKeyLabel(bind.primary)}</button>
        </td>
        <td class="kb-btn-cell">
          <button type="button" class="kb-bind-btn" data-action="${k}" data-type="secondary">${formatKeyLabel(bind.secondary)}</button>
        </td>
      </tr>
    `;
  }).join('');

  return `
    <div class="kb-settings-section">
      <h3 class="kb-section-title">⌨️ 메인화면 단축키 설정</h3>
      <table class="kb-table">
        <thead>
          <tr>
            <th class="kb-th-left">기능</th>
            <th class="kb-th-center">정 (Primary)</th>
            <th class="kb-th-center">부 (Secondary)</th>
          </tr>
        </thead>
        <tbody>${renderRows(MAIN_KEYS)}</tbody>
      </table>

      <hr class="kb-divider" />

      <h3 class="kb-section-title">🎮 인게임 단축키 설정</h3>
      <table class="kb-table">
        <thead>
          <tr>
            <th class="kb-th-left">기능</th>
            <th class="kb-th-center">정 (Primary)</th>
            <th class="kb-th-center">부 (Secondary)</th>
          </tr>
        </thead>
        <tbody>${renderRows(INGAME_KEYS)}</tbody>
      </table>
    </div>
  `;
}

export function bindKeybindingSettingsEvents(overlay, userConfig) {
  const bindButtons = overlay.querySelectorAll('.kb-bind-btn');
  bindButtons.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.activeKeybindBtn) return;

      window.activeKeybindBtn = btn;
      btn.innerText = '입력 대기...';
      btn.classList.add('waiting');

      const keydownHandler = (keyEvent) => {
        keyEvent.preventDefault();
        keyEvent.stopPropagation();

        const formattedKey = keyEvent.key;
        const action = btn.dataset.action;
        const type = btn.dataset.type;
        const targetGroup = MAIN_KEYS.includes(action) ? MAIN_KEYS : INGAME_KEYS;

        let isDuplicate = false;
        let duplicateLabel = '';

        for (const otherAction of targetGroup) {
          const otherBind = userConfig.keybindings[otherAction];
          if (!otherBind) continue;
          if (otherAction === action) {
            const otherType = type === 'primary' ? 'secondary' : 'primary';
            if ((otherBind[otherType] || '').toLowerCase() === formattedKey.toLowerCase()) {
              isDuplicate = true;
              duplicateLabel = `${otherBind.label} (${otherType === 'primary' ? '정' : '부'})`;
              break;
            }
          } else {
            if ((otherBind.primary || '').toLowerCase() === formattedKey.toLowerCase()) {
              isDuplicate = true;
              duplicateLabel = `${otherBind.label} (정)`;
              break;
            }
            if ((otherBind.secondary || '').toLowerCase() === formattedKey.toLowerCase()) {
              isDuplicate = true;
              duplicateLabel = `${otherBind.label} (부)`;
              break;
            }
          }
        }

        const displayKey = formatKeyLabel(formattedKey);
        if (isDuplicate) {
          alert(`이미 '${displayKey}' 키는 ${duplicateLabel}에 할당되어 있습니다.`);
          btn.innerText = formatKeyLabel(userConfig.keybindings[action][type]);
        } else {
          userConfig.keybindings[action][type] = formattedKey;
          btn.innerText = displayKey;
          updateVisualBadges(userConfig);
        }

        btn.classList.remove('waiting');
        window.activeKeybindBtn = null;
        window.removeEventListener('keydown', keydownHandler, true);
      };

      window.addEventListener('keydown', keydownHandler, true);
    });
  });
}

export function updateVisualBadges(userConfig) {
  if (!userConfig.keybindings) return;

  const ids = {
    popupLogin: 'kb-badge-popupLogin',
    toggleDomain: 'kb-badge-toggleDomain',
    toggleQuizDirection: 'kb-badge-toggleQuizDirection',
    popupProgress: 'kb-badge-popupProgress',
    popupSetting: 'kb-badge-popupSetting',
    popupLeaderboard: 'kb-badge-popupLeaderboard',
    popupHelp: 'kb-badge-popupHelp',
    startStudy: 'kb-badge-startStudy',
    startRecord: 'kb-badge-startRecord',
    startSpectator: 'kb-badge-startSpectator'
  };

  Object.keys(ids).forEach((action) => {
    const el = document.getElementById(ids[action]);
    if (el && userConfig.keybindings[action]) {
      const bind = userConfig.keybindings[action];
      el.innerText = formatKeyLabel(bind.primary || bind.secondary);
    }
  });
}

export function matchKey(e, bind) {
  if (!bind) return false;
  const key = e.key.toLowerCase();
  const primary = (bind.primary || '').toLowerCase();
  const secondary = (bind.secondary || '').toLowerCase();

  if (key === ' ' || key === 'space') {
    return primary === ' ' || primary === 'space' || secondary === ' ' || secondary === 'space';
  }
  return key === primary || key === secondary;
}

export function registerGlobalKeybindings(userConfig, callbacks) {
  window.addEventListener('keydown', (e) => {
    if (window.activeKeybindBtn) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

    if (e.key === 'Alt') {
      e.preventDefault();
      document.body.classList.add('show-keybinds');
      return;
    }

    const bindings = userConfig.keybindings || {};

    if (e.key === 'Escape') {
      const detailOverlay = document.querySelector('.char-detail-overlay');
      if (detailOverlay) {
        e.preventDefault();
        detailOverlay.remove();
        return;
      }

      const activeOverlay = document.querySelector('.modal-overlay');
      if (activeOverlay) {
        e.preventDefault();
        callbacks.onEscapeModal?.(activeOverlay);
        return;
      }
    }

    const spectatorLayer = document.getElementById('spectator-game-layer');
    if (spectatorLayer) {
      if (e.key === 'Escape') {
        e.preventDefault();
        callbacks.onEscapeSpectator?.();
        return;
      }
      if (matchKey(e, bindings.pauseResume)) {
        e.preventDefault();
        callbacks.onPauseResume?.();
        return;
      }
    }

    const optionsContainer = document.getElementById('options');
    if (optionsContainer && e.key === 'Escape') {
      e.preventDefault();
      callbacks.onEscapeQuiz?.();
      return;
    }

    if (!optionsContainer) {
      if (document.querySelector('.modal-overlay') || document.querySelector('.char-detail-overlay')) return;
      if (!document.getElementById('mode-selection-layer')) return;

      if (matchKey(e, bindings.toggleDomain)) {
        e.preventDefault();
        callbacks.onToggleDomain?.();
      } else if (matchKey(e, bindings.toggleQuizDirection)) {
        e.preventDefault();
        callbacks.onToggleQuizDirection?.();
      } else if (matchKey(e, bindings.popupProgress)) {
        e.preventDefault();
        callbacks.onPopupProgress?.();
      } else if (matchKey(e, bindings.popupSetting)) {
        e.preventDefault();
        callbacks.onPopupSetting?.();
      } else if (matchKey(e, bindings.popupLeaderboard)) {
        e.preventDefault();
        callbacks.onPopupLeaderboard?.();
      } else if (matchKey(e, bindings.popupHelp)) {
        e.preventDefault();
        callbacks.onPopupHelp?.();
      } else if (matchKey(e, bindings.popupLogin)) {
        e.preventDefault();
        callbacks.onPopupLogin?.();
      } else if (matchKey(e, bindings.startStudy)) {
        e.preventDefault();
        callbacks.onStartStudy?.();
      } else if (matchKey(e, bindings.startRecord)) {
        e.preventDefault();
        callbacks.onStartRecord?.();
      } else if (matchKey(e, bindings.startSpectator)) {
        e.preventDefault();
        callbacks.onStartSpectator?.();
      }
      return;
    }

    if (matchKey(e, bindings.pauseResume)) {
      e.preventDefault();
      callbacks.onPauseResume?.();
      return;
    }

    if (optionsContainer.style.pointerEvents === 'none') return;

    let optionIndex = -1;
    if (matchKey(e, bindings.option0)) optionIndex = 0;
    else if (matchKey(e, bindings.option1)) optionIndex = 1;
    else if (matchKey(e, bindings.option2)) optionIndex = 2;
    else if (matchKey(e, bindings.option3)) optionIndex = 3;

    if (optionIndex !== -1) {
      e.preventDefault();
      callbacks.onOptionSelect?.(optionIndex);
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.key === 'Alt') {
      e.preventDefault();
      document.body.classList.remove('show-keybinds');
    }
  });

  window.addEventListener('blur', () => {
    document.body.classList.remove('show-keybinds');
  });
}
