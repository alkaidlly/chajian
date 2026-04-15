/**
 * SillyTavern Rant Companion Extension
 * ===============================
 * 吐槽悬浮窗 UI 扩展：支持主 API 复用和独立 AI API，两种模式切换；
 * 内置人设编辑、Prompt 构建及设置管理。
 * 
 * 页面右下角显示悬浮窗，支持设置及吐槽功能。
 * 请直接引入 rant.js & rant.css
 */

jQuery(async () => {
    // 全局常量
    const EXT_ENABLED_STORAGE_KEY = 'chajian-extension-enabled-v1';
    const SETTINGS_STORE_KEY = 'chajian';
    const LEGACY_SETTINGS_STORE_KEY = 'rant';
    const RANT_STORAGE_KEY = 'rant-extension-settings-v1';
    const RANT_HISTORY_STORAGE_KEY = 'rant-extension-history-v1';
    const DEFAULT_HISTORY_FILE_PATH = 'E:/SillyTavern/SillyTavern-release/data/default-user/extensions/chajian/rant-history.json';
    const DEFAULT_PERSONA_ROLE_INSTRUCTION = '你将扮演“吐槽伴侣”这个角色。下面【吐槽角色人设】中的内容是你必须遵循的角色设定，请始终按该角色口吻进行回应。';
    const DEFAULT_PERSONA = '你是毒舌的刻薄影评人，总是一针见血又不失幽默风趣。';
    const DEFAULT_API = {
        endpoint: 'https://api.openai.com/v1/chat/completions',
        key: '',
        model: 'gpt-3.5-turbo'
    };
    const DEFAULT_RESPONSE_RULE = '只输出两部分：1) 角色对剧情的吐槽；2) 对用户输入内容的吐槽回应。不要输出思考过程、分析步骤、系统提示或额外说明。';
    const DEFAULT_RESPONSE_PRESETS = [
        { id: 'chat_clean', name: '线上聊天风', content: '只输出两部分：\n【剧情吐槽】（简短犀利，<=80字）\n【回应】（像聊天回复，<=80字）\n禁止输出动作描写、旁白、心理活动、系统提示、思考过程。' },
        { id: 'sarcasm', name: '毒舌吐槽风', content: '只输出两部分：\n【剧情吐槽】尖锐幽默，直戳重点\n【回应】像朋友互损式聊天，短句自然\n禁止小说体、动作括号、舞台指令。' },
        { id: 'gentle', name: '轻松安慰风', content: '只输出两部分：\n【剧情吐槽】轻松调侃不过界\n【回应】友好接梗，像即时聊天\n禁止长篇分析与剧情续写。' }
    ];
    const DEFAULT_COMPANION_NAME = '吐槽伴侣';

    // 扩展状态
    let context = null;
    let historyStorageMode = 'browser';
    let settings = loadSettings();
    let rantHistory = loadRantHistory();
    let activeScopeKey = null;
    let isDragging = false;
    let isGenerating = false;
    let isMinimized = true;
    let dragArmed = false;
    let dragStartPoint = {x: 0, y: 0};
    let suppressClickUntil = 0;
    let dragOffset = {x: 0, y: 0};

    // --- 初始化 DOM ---
    buildRantWindow();
    applyExtensionVisibility(isExtensionEnabled());
    renderCompanionName();
    updateModeDisplay();
    bindUIEventListeners();
    toggleMinimize(true);

    // --- 获取 SillyTavern API Context ---
    getSTContext();

    // --- 监听 SillyTavern 事件 ---
    function setupContextListeners() {
        if (!context) return;
        const event_types = context.event_types;
        context.eventSource.on(event_types.CHAT_CHANGED, refreshContextSensitiveOptions);
        context.eventSource.on(event_types.MESSAGE_RECEIVED, refreshContextSensitiveOptions);
    }

    // ========== UI 构建 ==========
    function buildRantWindow() {
        if ($("#rant-window").length) return; // 避免重复注入

        const win = $(`
<div id="rant-window" style="top:32px;left:32px;">
    <div id="rant-header">
        ${escapeHtml(settings.companionName || DEFAULT_COMPANION_NAME)}
        <button id="rant-minimize-btn" class="rant-btn" style="float:right;background:none;border:none;color:#ffffff;font-size:0.95em;cursor:pointer;margin-left:6px;">－</button>
        <button id="rant-settings-btn" style="float:right;background:none;border:none;color:#ffffff;font-size:0.95em;cursor:pointer;">⚙</button>
    </div>
    <div id="rant-storage-badge" style="height:20px;line-height:20px;padding:0 10px;font-size:11px;background:#ecfff4;color:#1f7a47;border-bottom:1px solid rgba(0,0,0,0.05);">保存：浏览器本地</div>
    <div id="rant-content" style="white-space:pre-line;">请输入内容，然后点击“吐槽”！</div>
    <div id="rant-footer">
        <input id="rant-input" type="text" placeholder="粘贴剧情或文本..." autocomplete="off" />
        <button id="rant-send" title="发送吐槽">发送</button>
    </div>
</div>
        `);

        // 设置界面
        const settingsDlg = $(`
<div id="rant-settings-modal" style="
    position:fixed; z-index:2147483601; background:#f6f6f6; padding:22px 20px; border-radius:10px; left:50%; top:50%; transform:translate(-50%,-56%);
    min-width:320px; width:min(700px, 90vw); max-height:82vh; overflow-y:auto; box-shadow:0 10px 36px rgba(0,0,0,0.22); color:#1f2329;display:none;border:1px solid #e3e3e3;">
    <div style="font-weight:700;font-size:1.1em;margin-bottom:12px;">吐槽伴侣 设置</div>
    <div style="margin-bottom:10px;">
        <label style="font-size:0.99em;">AI调用模式：</label>
        <select id="rant-mode-select" style="margin-left:8px;">
            <option value="main">复用主API</option>
            <option value="main_raw">主API直连(不吃预设)</option>
            <option value="custom">独立API</option>
        </select>
    </div>
    <div id="rant-custom-api-section" style="margin-bottom:12px; display:none;">
        <div style="margin-bottom:4px;">
            <label>API Endpoint:</label><br>
            <input id="rant-api-endpoint" type="text" style="width:99%;" placeholder="https://api.openai.com/v1/chat/completions"/>
        </div>
        <div style="margin-bottom:4px;">
            <label>API Key:</label><br>
            <input id="rant-api-key" type="password" style="width:99%;" placeholder="sk-xxx"/>
        </div>
        <div>
            <label>模型(Model):</label><br>
            <input id="rant-api-model" type="text" style="width:99%;" placeholder="gpt-3.5-turbo"/>
            <select id="rant-api-model-select" style="width:99%;margin-top:6px;display:none;"></select>
        </div>
        <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
            <button id="rant-fetch-models" class="rant-btn" style="background:#ffffff;color:#1f2329;border:1px solid #d8d8d8;padding:6px 12px;border-radius:7px;font-weight:600;">获取模型</button>
            <button id="rant-save-api-only" class="rant-btn" style="background:#07c160;color:#ffffff;border:none;padding:6px 12px;border-radius:7px;font-weight:600;">保存API</button>
        </div>
    </div>
    <div style="margin-bottom:12px;">
        <label>吐槽助手名称：</label>
        <input id="rant-companion-name" type="text" style="width:99%;margin-top:4px;" placeholder="吐槽伴侣" value="${escapeHtml(settings.companionName || DEFAULT_COMPANION_NAME)}"/>
    </div>
    <div style="margin-bottom:12px;">
        <label>吐槽角色人设：</label>
        <textarea id="rant-persona" rows="2" style="width:99%;border-radius:7px;border:1px solid #b4befe;resize:vertical;margin-top:4px;">${escapeHtml(settings.persona)}</textarea>
    </div>
    <div style="margin-bottom:7px;">
        <label>
            <input type="checkbox" id="rant-use-chat-history" ${settings.useChatHistory ? "checked":""} />
            启用{chatHistory}，将当前聊天历史融入Prompt
        </label>
    </div>
    <div style="margin-bottom:10px;">
        <label>
            <input type="checkbox" id="rant-strip-snow-tag" ${settings.stripSnowTag ? "checked":""} />
            发送前移除 &lt;snow&gt;...&lt;/snow&gt; 小剧场内容
        </label>
    </div>
    <div style="margin-bottom:12px;">
        <label>自定义排除标签（英文逗号分隔）</label><br>
        <input id="rant-excluded-tags" type="text" style="width:99%;" placeholder="snow,aside,ooc" value="${escapeHtml(settings.excludedTags || 'snow')}" />
    </div>
    <div style="margin-bottom:12px;display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div>
            <label>剧情楼层条数</label>
            <input id="rant-story-limit" type="number" min="0" max="100" style="width:100%;margin-top:4px;" value="${Number(settings.storyHistoryLimit || 16)}" />
        </div>
        <div>
            <label>吐槽记忆条数</label>
            <input id="rant-memory-limit" type="number" min="0" max="100" style="width:100%;margin-top:4px;" value="${Number(settings.rantMemoryLimit || 10)}" />
        </div>
    </div>
    <div style="margin-bottom:12px;">
        <label>AI回复预设（控制只输出什么）</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;margin-bottom:6px;">
            <select id="rant-preset-select" style="flex:1;min-width:180px;"></select>
            <button id="rant-apply-preset" class="rant-btn" style="background:#ffffff;color:#1f2329;border:1px solid #d8d8d8;padding:6px 10px;border-radius:7px;font-weight:600;">应用预设</button>
            <button id="rant-save-preset" class="rant-btn" style="background:#07c160;color:#ffffff;border:none;padding:6px 10px;border-radius:7px;font-weight:600;">保存为自定义</button>
        </div>
        <textarea id="rant-response-rule" rows="3" style="width:99%;border-radius:7px;border:1px solid #b4befe;resize:vertical;margin-top:4px;">${escapeHtml(settings.responseRule || '')}</textarea>
    </div>
    <div style="margin-bottom:10px;">
        <label>
            <input type="checkbox" id="rant-hide-thinking" ${settings.hideThinking !== false ? "checked":""} />
            隐藏AI思考内容（如 &lt;think&gt;...&lt;/think&gt;）
        </label>
    </div>
    <div style="margin-bottom:12px;display:flex;gap:10px;flex-wrap:wrap;">
        <button id="rant-export-history" class="rant-btn" style="background:#ffffff;color:#1f2329;border:1px solid #d8d8d8;padding:6px 12px;border-radius:7px;font-weight:600;">导出当前卡记录</button>
        <button id="rant-clear-history" class="rant-btn" style="background:#ff5f57;color:#ffffff;border:none;padding:6px 12px;border-radius:7px;font-weight:600;">清空当前卡记录</button>
    </div>
    <div id="rant-settings-actions" style="margin-top:14px;text-align:right;">
        <button id="rant-preview-prompt" class="rant-btn" style="margin-right:12px;background:#ffffff;color:#1f2329;padding:6px 12px;border:1px solid #d8d8d8;border-radius:7px;font-weight:600;">预览发送内容</button>
        <button id="rant-save-settings" class="rant-btn" style="margin-right:12px;background:#07c160;color:#ffffff;padding:6px 22px;border:none;border-radius:7px;font-weight:600;">保存</button>
        <button id="rant-close-settings" class="rant-btn" style="background:#ffffff;color:#1f2329;border:1px solid #d8d8d8;padding:6px 18px;border-radius:7px;font-weight:600;">关闭</button>
    </div>
</div>
        `);

        const previewDlg = $(`
<div id="rant-preview-modal" style="
    position:fixed; z-index:2147483602; background:#f6f6f6; padding:18px 16px; border-radius:10px; left:50%; top:50%; transform:translate(-50%,-50%);
    width:min(780px, 85vw); max-height:78vh; box-shadow:0 10px 36px rgba(0,0,0,0.22); color:#1f2329; display:none; border:1px solid #e3e3e3;">
    <div style="font-weight:700;font-size:1.02em;margin-bottom:10px;">预览：将发送给 AI 的内容</div>
    <textarea id="rant-preview-text" readonly style="width:100%;height:52vh;resize:none;border-radius:8px;border:1px solid #d8d8d8;background:#ffffff;color:#1f2329;padding:10px;line-height:1.45;"></textarea>
    <div style="margin-top:10px;text-align:right;">
        <button id="rant-close-preview" class="rant-btn" style="background:#07c160;color:#ffffff;border:none;padding:6px 16px;border-radius:7px;font-weight:600;">关闭</button>
    </div>
</div>
        `);

        $('body').append(win);
        $('body').append(settingsDlg);
        $('body').append(previewDlg);
    }

    // ========== 事件绑定 ==========
    function bindUIEventListeners() {
        const mobileUI = isMobileViewport();
        if (mobileUI) {
            $('#rant-minimize-btn').hide();
        }

        // 拖拽实现（按下即拖）
        $('#rant-header').on('mousedown', function(e) {
            if (mobileUI) return;
            if (isMinimized) return;
            if ($(e.target).is('#rant-settings-btn, #rant-minimize-btn')) return;
            beginDragFromEvent(e);
        });

        $('#rant-window').on('mousedown', function(e) {
            if (mobileUI) return;
            if (!isMinimized) return;
            e.preventDefault();
            dragArmed = true;
            dragStartPoint = {x: e.pageX, y: e.pageY};
        });

        $(document).on('mousemove', function(e) {
            if (dragArmed && !isDragging) {
                const dx = Math.abs(e.pageX - dragStartPoint.x);
                const dy = Math.abs(e.pageY - dragStartPoint.y);
                if (dx + dy >= 4) {
                    beginDragFromEvent(e);
                }
            }
            if (isDragging) {
                const win = $('#rant-window');
                win.css({
                    left: Math.max(0, e.pageX - dragOffset.x) + 'px',
                    top: Math.max(0, e.pageY - dragOffset.y) + 'px',
                    right:'',
                    bottom:''
                });
            }
        }).on('mouseup', function() {
            dragArmed = false;
            if (isDragging) {
                isDragging = false;
                $('body').css('user-select','');
                suppressClickUntil = Date.now() + 220;
            }
        });

        // 吐槽按钮
        $('#rant-send').on('click', handleRantSend);
        $('#rant-input').on('keydown', function(e) {
            if (e.key === 'Enter') handleRantSend();
        });

        // 设置按钮
        $('#rant-settings-btn').on('click', function() {
            showSettingsDialog();
        });
        $('#rant-minimize-btn').on('click', function(e) {
            e.stopPropagation();
            if (mobileUI) return;
            toggleMinimize(true);
        });

        // 设置弹窗
        $('#rant-close-settings').on('click', hideSettingsDialog);
        $('#rant-save-settings').on('click', saveSettingsFromDialog);
        $('#rant-preview-prompt').on('click', previewPromptFromCurrentInput);
        $('#rant-close-preview').on('click', hidePreviewDialog);
        $('#rant-clear-history').on('click', clearCurrentScopeHistory);
        $('#rant-export-history').on('click', exportCurrentScopeHistory);
        $('#rant-fetch-models').on('click', fetchModelsForApiConfig);
        $('#rant-save-api-only').on('click', saveApiOnlyFromDialog);
        $('#rant-apply-preset').on('click', applySelectedPresetToTextarea);
        $('#rant-save-preset').on('click', saveCurrentRuleAsPreset);
        $('#rant-api-model-select').on('change', function() {
            const picked = ($(this).val() || '').trim();
            if (picked) {
                $('#rant-api-model').val(picked);
                saveApiOnlyFromDialog(true);
                flashClick('#rant-api-model-select');
                setContent(`已选择模型：${picked}`);
            }
        });

        $('#rant-window button, #rant-settings-modal button, #rant-preview-modal button').on('click', function() {
            flashClick(this);
        });

        $('#rant-window').on('click', function() {
            if (Date.now() < suppressClickUntil) return;
            if (isMinimized) toggleMinimize(false);
        });

        // 模式切换
        $('#rant-mode-select').on('change', function() {
            settings.mode = this.value;
            updateModeDisplay();
            updateSettingsDialogDisplay();
        });
    }

    function beginDragFromEvent(e) {
        e.preventDefault();
        const win = $('#rant-window');
        if (!win.length) return;
        dragOffset.x = e.pageX - win.offset().left;
        dragOffset.y = e.pageY - win.offset().top;
        isDragging = true;
        $('body').css('user-select', 'none');
    }

    function isExtensionEnabled() {
        return localStorage.getItem(EXT_ENABLED_STORAGE_KEY) !== '0';
    }

    function applyExtensionVisibility(enabled) {
        const visible = !!enabled;
        const display = visible ? '' : 'none';
        $('#rant-window').css('display', display);
        if (!visible) {
            $('#rant-settings-modal').hide();
            $('#rant-preview-modal').hide();
        }
    }

    // ========== AI吐槽 ==========
    async function handleRantSend() {
        if (isGenerating) {
            setContent('正在生成中，请稍候…');
            return;
        }

        const input = $('#rant-input').val().trim();
        if (!input) {
            setContent('请先输入内容！');
            return;
        }
        $('#rant-input').val('');
        appendHistoryMessage('user', input);
        renderCurrentScopeHistory();
        setContent(`正在召唤${getCompanionName()}吐槽中…`);
        $('#rant-send').prop('disabled', true);

        try {
            isGenerating = true;
            let prompt = await buildPrompt(input);
            let reply = null;
            if (settings.mode === 'custom' || settings.mode === 'main_raw') {
                const apiConfig = settings.mode === 'main_raw'
                    ? getMainApiConfig()
                    : null;
                reply = await callCustomAPI(prompt, apiConfig);
            } else {
                reply = await callMainAPI(prompt);
            }
            const cleanedReply = sanitizeModelReply(reply);
            const displayItems = parseReplyForDisplay(cleanedReply || '[未能获取回复]');
            for (const item of displayItems) {
                appendHistoryMessage(item.role, item.text);
            }
            renderCurrentScopeHistory();
        } catch (err) {
            setContent('发生错误: ' + (err.message || err.toString()));
        } finally {
            isGenerating = false;
            $('#rant-send').prop('disabled', false);
        }
    }

    // ========== Prompt 构建 ==========
    async function buildPrompt(userText) {
        let persona = settings.persona || DEFAULT_PERSONA;
        let chatHistoryBlock = '';
        let rantMemoryBlock = '';
        let filteredUserText = applyInputFilters(userText);
        if (settings.useChatHistory) {
            const storyMessages = getStoryMessages();
            const storyLimit = clampLimit(settings.storyHistoryLimit, 16);
            chatHistoryBlock = storyMessages
                .map(msg => formatStoryMessage(msg))
                .filter(Boolean)
                .slice(-storyLimit)
                .join('\n');
        }
        rantMemoryBlock = getRantMemoryBlock(clampLimit(settings.rantMemoryLimit, 10));

        let promptTemplate = `${DEFAULT_PERSONA_ROLE_INSTRUCTION}\n【吐槽角色人设】\n${persona}\n\n`;
        if (settings.useChatHistory && chatHistoryBlock) {
            promptTemplate += `【当前剧情楼层（最近内容）】\n${chatHistoryBlock}\n\n`;
        }
        if (rantMemoryBlock) {
            promptTemplate += `【吐槽记忆（最近对话）】\n${rantMemoryBlock}\n\n`;
        }
        const responseRule = (settings.responseRule || '').trim();
        promptTemplate += `【本次用户吐槽点】\n${filteredUserText}\n`;
        if (responseRule) {
            promptTemplate += `\n【回复规则】\n${responseRule}\n`;
        }
        return promptTemplate;
    }

    // ========== 主 API 模式 ==========
    async function callMainAPI(prompt) {
        if (!context) throw new Error('SillyTavern context 不可用');

        if (typeof context.generateQuietPrompt === 'function') {
            try {
                const quietReply = await context.generateQuietPrompt(prompt);
                if (quietReply) return quietReply;
            } catch (_e) {
                // 回退到 generate，避免因静默接口异常导致不可用
            }
        }

        return await context.generate({
            prompt,
            system_prompt: '',
            user_name: '吐槽助手',
            stream: false
        });
    }

    // ========== 自定义 API 模式 ==========
    async function callCustomAPI(prompt, overrideApiConfig = null) {
        let {endpoint, key, model} = overrideApiConfig || settings.api || DEFAULT_API;
        if (!endpoint || !model) throw new Error('API 配置不完整');
        endpoint = normalizeApiEndpoint(endpoint);
        let body = {
            model,
            messages: [
                {role: 'user', content: prompt}
            ]
        };
        let resp = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...buildAuthHeader(key)
            },
            body: JSON.stringify(body)
        });
        if (!resp.ok) {
            let detail = '';
            try {
                detail = await resp.text();
            } catch (_e) {}
            throw new Error(`API 响应异常: ${resp.status}${detail ? ` - ${detail}` : ''}`);
        }
        let data = await resp.json();
        let content = data.choices?.[0]?.message?.content ?? '';
        if (!content) throw new Error('API 返回内容为空');
        return content;
    }

    function getMainApiConfig() {
        if (!context) throw new Error('SillyTavern context 不可用');
        const server = String(context.api_server || '').trim();
        if (!server) throw new Error('未读取到主 API 地址');

        const endpoint = normalizeApiEndpoint(`${server}/v1/chat/completions`);
        const key = String(context.api_key || '').trim();
        const model = String(
            context?.mainApiSettings?.model
            || context?.api_model
            || settings.api?.model
            || DEFAULT_API.model
        ).trim();
        return { endpoint, key, model };
    }

    // ========== 设置管理 ==========
    function loadSettings() {
        let local = {};
        try {
            local = JSON.parse(localStorage.getItem(RANT_STORAGE_KEY) || '{}') || {};
        } catch (_e) {
            local = {};
        }
        // 优先 SillyTavern extensionSettings(初始化时为空,稍后覆盖)
        return {
            mode: local.mode || 'main',
            api: {...DEFAULT_API, ...(local.api||{})},
            companionName: typeof local.companionName === 'string' ? local.companionName : DEFAULT_COMPANION_NAME,
            persona: local.persona != null ? local.persona : DEFAULT_PERSONA,
            useChatHistory: local.useChatHistory || false,
            stripSnowTag: local.stripSnowTag !== false,
            excludedTags: normalizeExcludedTagsInput(typeof local.excludedTags === 'string' ? local.excludedTags : 'snow'),
            storyHistoryLimit: Number.isFinite(Number(local.storyHistoryLimit)) ? Number(local.storyHistoryLimit) : 16,
            rantMemoryLimit: Number.isFinite(Number(local.rantMemoryLimit)) ? Number(local.rantMemoryLimit) : 10,
            responseRule: typeof local.responseRule === 'string'
                ? local.responseRule
                : DEFAULT_RESPONSE_RULE,
            historyFilePath: typeof local.historyFilePath === 'string' ? local.historyFilePath : DEFAULT_HISTORY_FILE_PATH,
            promptPresets: normalizePresets(local.promptPresets),
            activePresetId: typeof local.activePresetId === 'string' ? local.activePresetId : DEFAULT_RESPONSE_PRESETS[0].id,
            hideThinking: local.hideThinking !== false
        };
    }

    function saveSettings() {
        // 兼容 extensionSettings 的两种形态：方法接口(get/set) 与对象字典
        if (context?.extensionSettings) {
            const ext = context.extensionSettings;
            if (typeof ext.set === 'function') {
                ext.set(SETTINGS_STORE_KEY, settings);
            } else {
                ext[SETTINGS_STORE_KEY] = settings;
            }
        }
        localStorage.setItem(RANT_STORAGE_KEY, JSON.stringify(settings));
    }

    function updateSettingsFromContext() {
        if (!context?.extensionSettings) return;

        const extStore = context.extensionSettings;
        const ext = typeof extStore.get === 'function'
            ? (extStore.get(SETTINGS_STORE_KEY) || extStore.get(LEGACY_SETTINGS_STORE_KEY))
            : (extStore[SETTINGS_STORE_KEY] || extStore[LEGACY_SETTINGS_STORE_KEY]);

        if (ext) {
            settings = {
                ...settings,
                ...ext,
                api: {...DEFAULT_API, ...(ext.api || settings.api || {})}
            };
            settings.excludedTags = normalizeExcludedTagsInput(settings.excludedTags || 'snow');
            updateModeDisplay();
            renderCompanionName();
            // 完成一次旧键迁移，避免后续被同名键污染
            saveSettings();
        }
    }

    // ========== 设置弹窗 ==========
    function showSettingsDialog() {
        $('#rant-settings-modal').show();
        $('#rant-mode-select').val(settings.mode);
        $('#rant-api-endpoint').val(settings.api.endpoint);
        $('#rant-api-key').val(settings.api.key);
        $('#rant-api-model').val(settings.api.model);
        $('#rant-companion-name').val(settings.companionName || DEFAULT_COMPANION_NAME);
        $('#rant-persona').val(settings.persona);
        $('#rant-use-chat-history').prop('checked', !!settings.useChatHistory);
        $('#rant-strip-snow-tag').prop('checked', !!settings.stripSnowTag);
        $('#rant-excluded-tags').val(settings.excludedTags || 'snow');
        $('#rant-story-limit').val(Number(settings.storyHistoryLimit || 16));
        $('#rant-memory-limit').val(Number(settings.rantMemoryLimit || 10));
        $('#rant-response-rule').val(settings.responseRule || '');
        renderPresetOptions();
        $('#rant-preset-select').val(settings.activePresetId || '');
        $('#rant-hide-thinking').prop('checked', settings.hideThinking !== false);
        updateSettingsDialogDisplay();
    }

    function hideSettingsDialog() {
        $('#rant-settings-modal').hide();
    }

    function showPreviewDialog(text) {
        $('#rant-preview-text').val(String(text || ''));
        $('#rant-preview-modal').show();
    }

    function hidePreviewDialog() {
        $('#rant-preview-modal').hide();
    }

    function saveSettingsFromDialog() {
        settings.mode = $('#rant-mode-select').val();
        settings.api = {
            endpoint: $('#rant-api-endpoint').val().trim(),
            key: $('#rant-api-key').val().trim(),
            model: $('#rant-api-model').val().trim()
        };
        settings.companionName = ($('#rant-companion-name').val() || '').trim() || DEFAULT_COMPANION_NAME;
        settings.persona = $('#rant-persona').val().trim();
        settings.useChatHistory = $('#rant-use-chat-history').prop('checked');
        settings.stripSnowTag = $('#rant-strip-snow-tag').prop('checked');
        settings.excludedTags = normalizeExcludedTagsInput($('#rant-excluded-tags').val());
        $('#rant-excluded-tags').val(settings.excludedTags);
        settings.storyHistoryLimit = clampLimit($('#rant-story-limit').val(), 16);
        settings.rantMemoryLimit = clampLimit($('#rant-memory-limit').val(), 10);
        settings.responseRule = ($('#rant-response-rule').val() || '').trim();
        settings.activePresetId = ($('#rant-preset-select').val() || '').trim() || settings.activePresetId;
        settings.hideThinking = $('#rant-hide-thinking').prop('checked');
        saveSettings();
        renderCompanionName();
        setContent('设置已保存。');
    }

    function saveApiOnlyFromDialog(silent = false) {
        settings.api = {
            endpoint: ($('#rant-api-endpoint').val() || '').trim(),
            key: ($('#rant-api-key').val() || '').trim(),
            model: ($('#rant-api-model').val() || '').trim()
        };
        saveSettings();
        if (!silent) setContent('API 配置已保存。');
    }

    async function fetchModelsForApiConfig() {
        const endpoint = ($('#rant-api-endpoint').val() || '').trim();
        const key = ($('#rant-api-key').val() || '').trim();
        if (!endpoint) {
            setContent('请先填写 API Endpoint。');
            return;
        }

        try {
            const modelListUrl = buildModelsEndpoint(endpoint);
            const resp = await fetch(modelListUrl, {
                method: 'GET',
                headers: {
                    ...buildAuthHeader(key)
                }
            });
            if (!resp.ok) {
                throw new Error(`获取模型失败: ${resp.status}`);
            }
            const data = await resp.json();
            const models = Array.isArray(data?.data)
                ? data.data.map(x => x?.id).filter(Boolean)
                : [];
            if (!models.length) {
                throw new Error('接口未返回可用模型列表');
            }
            renderModelSelector(models);
            $('#rant-api-model').val(models[0]);
            saveApiOnlyFromDialog(true);
            showPreviewDialog(`可用模型（共 ${models.length} 个）:\n\n${models.join('\n')}`);
            setContent(`已获取模型，默认填入：${models[0]}`);
        } catch (err) {
            setContent('获取模型失败: ' + (err.message || err.toString()));
        }
    }

    function renderModelSelector(models) {
        const select = $('#rant-api-model-select');
        select.empty();
        select.append($('<option>').val('').text('请选择模型...'));
        for (const model of models) {
            select.append($('<option>').val(model).text(model));
        }
        select.show();
    }

    function renderPresetOptions() {
        const select = $('#rant-preset-select');
        if (!select.length) return;
        const presets = settings.promptPresets || DEFAULT_RESPONSE_PRESETS;
        select.empty();
        for (const preset of presets) {
            select.append($('<option>').val(preset.id).text(preset.name));
        }
        if (!presets.find(p => p.id === settings.activePresetId)) {
            settings.activePresetId = presets[0]?.id || '';
        }
    }

    function applySelectedPresetToTextarea() {
        const selectedId = ($('#rant-preset-select').val() || '').trim();
        const preset = (settings.promptPresets || []).find(p => p.id === selectedId);
        if (!preset) {
            setContent('未找到所选预设。');
            return;
        }
        settings.activePresetId = selectedId;
        $('#rant-response-rule').val(preset.content || '');
        setContent(`已应用预设：${preset.name}`);
    }

    function saveCurrentRuleAsPreset() {
        const currentRule = ($('#rant-response-rule').val() || '').trim();
        if (!currentRule) {
            setContent('当前回复规则为空，无法保存。');
            return;
        }
        const name = window.prompt('请输入预设名称：', '我的自定义预设');
        if (!name) return;
        const presetId = `custom_${Date.now()}`;
        const nextPreset = {
            id: presetId,
            name: String(name).trim() || '我的自定义预设',
            content: currentRule
        };
        settings.promptPresets = [...(settings.promptPresets || []), nextPreset];
        settings.activePresetId = presetId;
        renderPresetOptions();
        $('#rant-preset-select').val(presetId);
        saveSettings();
        setContent(`已保存自定义预设：${nextPreset.name}`);
    }

    function updateSettingsDialogDisplay() {
        const mode = $('#rant-mode-select').val();
        if (mode === 'custom') {
            $('#rant-custom-api-section').show();
        } else {
            $('#rant-custom-api-section').hide();
        }
    }

    function updateModeDisplay() {
        if (isMinimized) return;
        // 统一使用微信绿色标题栏，避免与模式色冲突
        $('#rant-header').css('background', '#07c160');
    }

    function toggleMinimize(next) {
        if (isMobileViewport()) return;
        isMinimized = !!next;
        const win = $('#rant-window');
        if (isMinimized) {
            win.addClass('minimized');
            $('#rant-settings-modal').hide();
            $('#rant-preview-modal').hide();
        } else {
            win.removeClass('minimized');
            updateModeDisplay();
        }
    }

    function getCompanionName() {
        return (settings.companionName || '').trim() || DEFAULT_COMPANION_NAME;
    }

    function renderCompanionName() {
        if (isMinimized) return;
        const header = $('#rant-header');
        const btn = $('#rant-settings-btn');
        if (!header.length || !btn.length) return;
        header.contents().filter(function() {
            return this.nodeType === 3;
        }).remove();
        header.prepend(document.createTextNode(getCompanionName()));
    }

    async function previewPromptFromCurrentInput() {
        const input = ($('#rant-input').val() || '').trim();
        if (!input) {
            showPreviewDialog('预览失败：请先在输入框写入要吐槽的文本。');
            return;
        }
        try {
            const prompt = await buildPrompt(input);
            showPreviewDialog(prompt);
        } catch (err) {
            showPreviewDialog('预览失败: ' + (err.message || err.toString()));
        }
    }
    
    // ========== 通用 ==========
    function setContent(text) {
        appendMessageToContent('system', text);
    }

    function clearContent() {
        $('#rant-content').empty();
    }

    function updateStorageBadge() {
        const text = historyStorageMode === 'file' ? '保存：本地文件 + 浏览器兜底' : '保存：浏览器本地';
        $('#rant-storage-badge').text(text);
    }

    function appendHistoryMessage(role, text) {
        const key = getCurrentScopeKey();
        if (!key) return;
        if (!rantHistory[key]) rantHistory[key] = [];
        rantHistory[key].push({
            role,
            text: String(text ?? ''),
            ts: Date.now()
        });
        if (rantHistory[key].length > 200) {
            rantHistory[key] = rantHistory[key].slice(-200);
        }
        saveRantHistory();
    }

    function renderCurrentScopeHistory() {
        const key = getCurrentScopeKey();
        if (!key) {
            clearContent();
            setContent('请选择角色卡后使用吐槽伴侣。');
            return;
        }
        const list = rantHistory[key] || [];
        clearContent();

        if (!list.length) {
            setContent('请输入内容，然后点击“吐槽”！');
            return;
        }

        const start = Math.max(0, list.length - 80);
        let lastTs = 0;
        for (let i = start; i < list.length; i++) {
            const item = list[i];
            const uiRole = item.role === 'assistant'
                ? 'assistant'
                : (item.role === 'system' ? 'system' : 'user');
            if (shouldShowTimestamp(lastTs, item.ts)) {
                appendTimestampSeparator(item.ts);
                lastTs = Number(item.ts || 0);
            }
            appendMessageToContent(uiRole, item.text, item.ts);
        }
    }

    function appendMessageToContent(role, text, ts = Date.now()) {
        const contentDiv = $('#rant-content');
        const safeText = escapeHtml(String(text ?? '')).replace(/\n/g, '<br>');
        const rowClass = role === 'system' ? 'rant-row system' : `rant-row ${role}`;
        const bubble = `<div class="rant-message ${role}">${safeText}</div>`;
        const html = role === 'system'
            ? `<div class="${rowClass}" data-ts="${Number(ts || Date.now())}">${bubble}</div>`
            : `<div class="${rowClass}" data-ts="${Number(ts || Date.now())}">${bubble}</div>`;
        contentDiv.append(html);

        const rows = contentDiv.children('.rant-row, .rant-time-separator');
        if (rows.length > 180) {
            rows.first().remove();
        }

        if (contentDiv[0]) {
            contentDiv.scrollTop(contentDiv[0].scrollHeight);
        }
    }

    function shouldShowTimestamp(lastTs, currentTs) {
        const prev = Number(lastTs || 0);
        const cur = Number(currentTs || 0);
        if (!cur) return false;
        if (!prev) return true;
        return (cur - prev) >= 5 * 60 * 1000;
    }

    function appendTimestampSeparator(ts) {
        const contentDiv = $('#rant-content');
        const label = formatTimestamp(ts);
        contentDiv.append(`<div class="rant-time-separator">${escapeHtml(label)}</div>`);
    }

    function formatTimestamp(ts) {
        const d = new Date(Number(ts || Date.now()));
        const h = String(d.getHours()).padStart(2, '0');
        const m = String(d.getMinutes()).padStart(2, '0');
        return `${h}:${m}`;
    }

    function getRantMemoryBlock(limit = 10) {
        const key = getCurrentScopeKey();
        if (!key) return '';
        const list = rantHistory[key] || [];
        if (!list.length) return '';
        const start = Math.max(0, list.length - limit);
        return list
            .slice(start)
            .filter(item => item.role === 'assistant' || item.role === 'user')
            .map(item => `${item.role === 'assistant' ? 'AI' : '用户'}: ${String(item.text || '')}`)
            .join('\n');
    }

    function clearCurrentScopeHistory() {
        const key = getCurrentScopeKey();
        if (!key) {
            setContent('当前未识别到角色卡。');
            return;
        }
        const count = (rantHistory[key] || []).length;
        if (!count) {
            setContent('当前卡暂无可清空的记录。');
            return;
        }
        rantHistory[key] = [];
        saveRantHistory();
        renderCurrentScopeHistory();
        setContent('已清空当前卡的吐槽记录。');
    }

    function exportCurrentScopeHistory() {
        const key = getCurrentScopeKey();
        if (!key) {
            setContent('当前未识别到角色卡。');
            return;
        }
        const list = rantHistory[key] || [];
        if (!list.length) {
            setContent('当前卡没有可导出的记录。');
            return;
        }

        const lines = [];
        lines.push(`# Rant History (${key})`);
        lines.push(`Exported: ${new Date().toISOString()}`);
        lines.push('');

        for (const item of list) {
            const roleLabel = item.role === 'assistant' ? 'AI' : 'User';
            const ts = item.ts ? new Date(item.ts).toLocaleString() : '';
            lines.push(`[${roleLabel}] ${ts}`);
            lines.push(String(item.text || ''));
            lines.push('');
        }

        const text = lines.join('\n');
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const safeKey = String(key).replace(/[\\/:*?"<>|]/g, '_');
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        a.href = url;
        a.download = `rant-history-${safeKey}-${stamp}.txt`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        setContent(`已导出当前卡记录（${list.length} 条）。`);
    }

    function escapeHtml(str) {
        return (str || '').replace(/[<>&"]/g, s => ({
            '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;'
        }[s]));
    }

    function flashClick(target) {
        const el = $(target);
        if (!el.length) return;
        el.addClass('rant-btn-clicked');
        setTimeout(() => el.removeClass('rant-btn-clicked'), 140);
    }

    function buildAuthHeader(key) {
        const token = String(key || '').trim();
        return token ? { 'Authorization': `Bearer ${token}` } : {};
    }

    function normalizeApiEndpoint(endpoint) {
        const raw = String(endpoint || '').trim();
        if (!raw) return '';
        if (/\/v1\/chat\/completions\/?$/i.test(raw)) {
            return raw.replace(/\/+$/, '');
        }
        if (/\/v1\/?$/i.test(raw)) {
            return `${raw.replace(/\/+$/, '')}/chat/completions`;
        }
        return `${raw.replace(/\/+$/, '')}/v1/chat/completions`;
    }

    function buildModelsEndpoint(endpoint) {
        const completionUrl = normalizeApiEndpoint(endpoint);
        return completionUrl.replace(/\/chat\/completions$/i, '/models');
    }

    function applyInputFilters(text) {
        let result = String(text ?? '');

        if (settings.stripSnowTag) {
            const tags = parseExcludedTags(settings.excludedTags);
            for (const tag of tags) {
                result = removeTaggedBlock(result, tag);
            }
        }

        return result.trim();
    }

    function sanitizeModelReply(text) {
        let result = String(text ?? '').trim();
        if (!result) return '';

        if (settings.hideThinking !== false) {
            result = result
                .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '')
                .replace(/<thinking\b[^>]*>[\s\S]*?<\/thinking>/gi, '')
                .replace(/```(?:thinking|thought|analysis)[\s\S]*?```/gi, '')
                .replace(/^\s*(思考|分析|推理|thought|analysis)\s*[:：][\s\S]*?(?=\n{2,}|$)/gim, '');
        }

        return result.trim();
    }

    function splitReplyToChunks(text) {
        const normalized = String(text || '')
            .replace(/\r\n/g, '\n')
            .trim();
        if (!normalized) return [];

        const rawParts = normalized
            .split(/\n+/)
            .flatMap(line => line.split(/(?<=[。！？!?；;])/))
            .map(s => s.trim())
            .filter(Boolean);

        const chunks = [];
        for (const part of rawParts) {
            if (part.length <= 90) {
                chunks.push(part);
                continue;
            }
            for (let i = 0; i < part.length; i += 90) {
                chunks.push(part.slice(i, i + 90));
            }
        }
        return chunks.length ? chunks : [normalized];
    }

    function parseReplyForDisplay(text) {
        const raw = String(text || '').trim();
        if (!raw) return [];

        const markerRegex = /(【(?:剧情吐槽|回应)】)/g;
        if (!markerRegex.test(raw)) {
            return splitReplyToChunks(raw).map(x => ({ role: 'assistant', text: x }));
        }

        const tokens = raw.split(markerRegex).map(t => t.trim()).filter(Boolean);
        const out = [];
        for (const token of tokens) {
            if (/^【(?:剧情吐槽|回应)】$/.test(token)) {
                out.push({ role: 'system', text: token });
            } else {
                const chunks = splitReplyToChunks(token);
                for (const c of chunks) out.push({ role: 'assistant', text: c });
            }
        }
        return out;
    }

    function getStoryMessages() {
        if (!context) return [];
        const directChat = Array.isArray(context.chat) ? context.chat : null;
        if (directChat) return directChat;

        const getterChat = context?.chat?.getMessages;
        if (typeof getterChat === 'function') {
            try {
                const data = getterChat.call(context.chat);
                if (Array.isArray(data)) return data;
            } catch (_e) {}
        }

        if (typeof context.getChatMessages === 'function') {
            try {
                const data = context.getChatMessages();
                if (Array.isArray(data)) return data;
            } catch (_e) {}
        }
        return [];
    }

    function formatStoryMessage(msg) {
        const text = applyInputFilters(extractMessageText(msg));
        if (!text) return '';

        const isUser = !!(msg?.is_user || msg?.isUser || msg?.role === 'user' || msg?.name === 'You');
        const speaker = isUser ? '你' : '角色';
        return `${speaker}: ${text}`;
    }

    function extractMessageText(msg) {
        if (!msg) return '';
        return String(
            msg.mes
            || msg.text
            || msg.content
            || msg.message
            || ''
        );
    }

    function parseExcludedTags(input) {
        const raw = String(normalizeExcludedTagsInput(input || 'snow'))
            .split(',')
            .map(t => t.trim().toLowerCase())
            .filter(Boolean);
        const unique = [...new Set(raw)];
        return unique.length ? unique : ['snow'];
    }

    function normalizeExcludedTagsInput(input) {
        return String(input || 'snow')
            .replace(/[，、；;]/g, ',')
            .split(',')
            .map(t => t.trim().toLowerCase())
            .filter(Boolean)
            .join(',');
    }

    function clampLimit(value, fallback) {
        const num = Number(value);
        if (!Number.isFinite(num)) return fallback;
        return Math.max(0, Math.min(100, Math.floor(num)));
    }

    function normalizePresets(inputPresets) {
        const base = [...DEFAULT_RESPONSE_PRESETS];
        if (!Array.isArray(inputPresets)) return base;
        const valid = inputPresets
            .filter(p => p && typeof p === 'object')
            .map((p, i) => ({
                id: String(p.id || `preset_${i}`),
                name: String(p.name || `预设${i + 1}`),
                content: String(p.content || '')
            }))
            .filter(p => p.content.trim());
        const merged = [...base];
        for (const p of valid) {
            if (!merged.find(x => x.id === p.id)) {
                merged.push(p);
            }
        }
        return merged.length ? merged : base;
    }

    function removeTaggedBlock(text, tagName) {
        const pattern = new RegExp(`<${tagName}\\b[^>]*>[\\s\\S]*?<\\/${tagName}>`, 'gi');
        return text.replace(pattern, '');
    }

    function refreshContextSensitiveOptions() {
        const newScope = getCurrentScopeKey();
        if (!newScope) return;
        if (newScope !== activeScopeKey) {
            migrateLegacyGlobalHistoryToScope(newScope);
            activeScopeKey = newScope;
            renderCurrentScopeHistory();
        }
    }

    function migrateLegacyGlobalHistoryToScope(scopeKey) {
        if (!scopeKey) return;
        if (Array.isArray(rantHistory[scopeKey]) && rantHistory[scopeKey].length) return;
        const legacyGlobal = Array.isArray(rantHistory.global) ? rantHistory.global : [];
        if (!legacyGlobal.length) return;
        rantHistory[scopeKey] = legacyGlobal.map(item => ({
            role: item?.role || 'assistant',
            text: String(item?.text ?? ''),
            ts: Number(item?.ts || Date.now())
        }));
        saveRantHistory();
    }

    function loadRantHistory() {
        const fileHistory = loadRantHistoryFromFile();
        const browserHistory = loadRantHistoryFromBrowser();
        const hasFileData = hasHistoryData(fileHistory);
        const hasBrowserData = hasHistoryData(browserHistory);

        if (hasFileData && hasBrowserData) {
            historyStorageMode = 'file';
            updateStorageBadge();
            return {
                ...browserHistory,
                ...fileHistory
            };
        }
        if (hasFileData) {
            historyStorageMode = 'file';
            updateStorageBadge();
            return fileHistory;
        }
        if (hasBrowserData) {
            historyStorageMode = 'browser';
            updateStorageBadge();
            return browserHistory;
        }
        historyStorageMode = 'browser';
        updateStorageBadge();
        return {};
    }

    function loadRantHistoryFromBrowser() {
        try {
            const raw = JSON.parse(localStorage.getItem(RANT_HISTORY_STORAGE_KEY) || '{}');
            return raw && typeof raw === 'object' ? raw : {};
        } catch (_e) {
            return {};
        }
    }

    function hasHistoryData(data) {
        if (!data || typeof data !== 'object') return false;
        return Object.values(data).some((list) => Array.isArray(list) && list.length > 0);
    }

    function saveRantHistory() {
        localStorage.setItem(RANT_HISTORY_STORAGE_KEY, JSON.stringify(rantHistory));
        saveRantHistoryToFile(rantHistory);
    }

    function loadRantHistoryFromFile() {
        try {
            const fs = getNodeFs();
            if (!fs) return null;
            const targetPath = getHistoryFilePath();
            if (!targetPath || !fs.existsSync(targetPath)) return null;
            const text = fs.readFileSync(targetPath, 'utf8');
            const data = JSON.parse(text || '{}');
            if (!data || typeof data !== 'object') return null;
            return data;
        } catch (_e) {
            return null;
        }
    }

    function saveRantHistoryToFile(data) {
        try {
            const fs = getNodeFs();
            if (!fs) {
                historyStorageMode = 'browser';
                updateStorageBadge();
                return;
            }
            const pathMod = getNodePath();
            if (!pathMod) {
                historyStorageMode = 'browser';
                updateStorageBadge();
                return;
            }
            const targetPath = getHistoryFilePath();
            if (!targetPath) {
                historyStorageMode = 'browser';
                updateStorageBadge();
                return;
            }
            const dir = pathMod.dirname(targetPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(targetPath, JSON.stringify(data || {}, null, 2), 'utf8');
            historyStorageMode = 'file';
            updateStorageBadge();
        } catch (_e) {
            // 文件写入失败时静默回退到 localStorage
            historyStorageMode = 'browser';
            updateStorageBadge();
        }
    }

    function getHistoryFilePath() {
        return String(settings?.historyFilePath || DEFAULT_HISTORY_FILE_PATH).replace(/\\/g, '/');
    }

    function getNodeFs() {
        try {
            if (window.require) return window.require('fs');
        } catch (_e) {}
        return null;
    }

    function getNodePath() {
        try {
            if (window.require) return window.require('path');
        } catch (_e) {}
        return null;
    }

    function isMobileViewport() {
        return window.matchMedia('(max-width: 768px)').matches;
    }

    function getCurrentScopeKey() {
        if (!context) return null;
        const characterId = context.characterId || context.character_id || context.character?.id;
        const avatar = context.character?.avatar;
        const name = context.character?.name;
        const chatId = context.chatId || context.chat_id || context.chat?.id;
        const groupId = context.groupId || context.group_id;
        return characterId || avatar || name || groupId || chatId || null;
    }

    function getSTContext() {
        if (window.SillyTavern && typeof window.SillyTavern.getContext === 'function') {
            context = SillyTavern.getContext();
            setupContextListeners();
            updateSettingsFromContext();
            activeScopeKey = getCurrentScopeKey();
            migrateLegacyGlobalHistoryToScope(activeScopeKey);
            renderCurrentScopeHistory();
        } else {
            let retried = 0;
            const retry = () => {
                if (window.SillyTavern && typeof window.SillyTavern.getContext === 'function') {
                    context = SillyTavern.getContext();
                    setupContextListeners();
                    updateSettingsFromContext();
                    activeScopeKey = getCurrentScopeKey();
                    migrateLegacyGlobalHistoryToScope(activeScopeKey);
                    renderCurrentScopeHistory();
                } else if (retried++ < 12) {
                    setTimeout(retry, 600);
                } else {
                    setContent('未能检测到 SillyTavern 主程序。吐槽主API模式不可用。');
                }
            };
            retry();
        }
    }

    // ========== 初始化完成 ==========
    activeScopeKey = getCurrentScopeKey();
    if (activeScopeKey) {
        renderCurrentScopeHistory();
    }

    // 尝试页面卸载时保存设置（保险）
    window.addEventListener('beforeunload', saveSettings);
    window['chajianSetVisible'] = applyExtensionVisibility;

});