(() => {
    const MODULE_ID = 'chajian';
    const SETTINGS_ROOT_ID = 'chajian-settings-panel';
    const SCRIPT_SRC = 'scripts/extensions/third-party/chajian/rant.js';
    const SETTINGS_HTML_PATH = '/scripts/extensions/third-party/chajian/settings.html';
    const ENABLED_STORAGE_KEY = 'chajian-extension-enabled-v1';

    function isPluginEnabled() {
        return localStorage.getItem(ENABLED_STORAGE_KEY) !== '0';
    }

    function setPluginEnabled(enabled) {
        localStorage.setItem(ENABLED_STORAGE_KEY, enabled ? '1' : '0');
    }

    function applyPluginVisibility(enabled) {
        const visible = !!enabled;
        const displayValue = visible ? '' : 'none';
        $('#rant-window').css('display', displayValue);
        $('#rant-settings-modal').css('display', displayValue);
        $('#rant-preview-modal').css('display', displayValue);

        const externalSetVisible = window['chajianSetVisible'];
        if (typeof externalSetVisible === 'function') {
            externalSetVisible(visible);
        }
    }

    function injectMainScript() {
        if (document.querySelector(`script[src="${SCRIPT_SRC}"]`)) return;
        const script = document.createElement('script');
        script.src = SCRIPT_SRC;
        script.defer = true;
        document.head.appendChild(script);
    }

    async function mountSettingsPanel() {
        const container = document.querySelector('#extensions_settings');
        if (!container) return;
        if (document.getElementById(SETTINGS_ROOT_ID)) return;

        try {
            const html = await $.get(SETTINGS_HTML_PATH);
            $('#extensions_settings').append(html);

            const enabled = isPluginEnabled();
            $('#chajian-enabled-toggle').prop('checked', enabled);
            applyPluginVisibility(enabled);

            $('#chajian-enabled-toggle').on('change', function () {
                const nextEnabled = $(this).prop('checked');
                setPluginEnabled(nextEnabled);
                applyPluginVisibility(nextEnabled);
            });
        } catch (error) {
            console.error(`[${MODULE_ID}] Failed to mount settings panel:`, error);
        }
    }

    function mountWhenReady() {
        if (!(window.SillyTavern && typeof window.SillyTavern.getContext === 'function')) return;
        const context = window.SillyTavern.getContext();
        const { eventSource, event_types } = context;

        eventSource.on(event_types.APP_READY, mountSettingsPanel);
        mountSettingsPanel();
    }

    injectMainScript();
    applyPluginVisibility(isPluginEnabled());

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mountWhenReady, { once: true });
    } else {
        mountWhenReady();
    }
})();
