
 // ==UserScript==
 // @name         问卷星自动填写助手
 // @namespace    https://www.wjx.top/
 // @version      8.0.0
 // @description  自动识别问卷题目、匹配预设答案并填写
 // @match        https://www.wjx.top/*
 // @match        https://*.wjx.top/*
 // @match        https://www.wjx.cn/*
 // @match        https://*.wjx.cn/*
 // @match        https://www.wjx.com/*
 // @match        https://*.wjx.com/*
 // @run-at       document-idle
 // @grant        none
 // ==/UserScript==

 (() => {
   'use strict';

   const VERSION = '8.0.0';
   const RULES_KEY = 'wjx_auto_fill_rules_v8';
   const PANEL_ID = 'wjx-auto-fill-panel-v8';
   const START_FLAG = '__WJX_AUTO_FILL_V8__';

   if (window[START_FLAG]) return;
   window[START_FLAG] = true;

   const log = (...args) => console.log('[问卷填写助手]', ...args);

   const defaultRules = [
     // 示例规则。使用前请改成自己的题目关键词和真实答案。
     // { keyword: '你喜欢的颜色', answer: '蓝色' },
     // { keyword: '你使用的操作系统', answer: 'Windows' }
   ];

   function loadRules() {
     try {
       const saved = localStorage.getItem(RULES_KEY);
       const rules = saved ? JSON.parse(saved) : defaultRules;
       return Array.isArray(rules)
         ? rules.filter(r => r && typeof r.keyword === 'string')
         : [];
     } catch (error) {
       console.error('[问卷填写助手] 读取规则失败：', error);
       return [];
     }
   }

   let rules = loadRules();
   let results = [];
   let scanTimer = null;
   let observer = null;

   const normalize = value =>
     String(value ?? '').replace(/\s+/g, '').toLowerCase();

   function getQuestionBlocks() {
     const selectors = [
       '.field',
       '.div_question',
       '.question',
       '[id^="div"]'
     ];

     const found = new Set();

     for (const selector of selectors) {
       document.querySelectorAll(selector).forEach(el => {
         if (!el.querySelector('input, textarea, select')) return;

         const text = getQuestionText(el);
         if (text) found.add(el);
       });
     }

     // 兼容未识别到标准题目容器的情况
     if (!found.size) {
       document.querySelectorAll('input, textarea, select').forEach(control => {
         const parent = control.closest('li, section, fieldset, div');
         if (parent && getQuestionText(parent)) found.add(parent);
       });
     }

     // 避免同时处理外层题目和内层子容器
     return [...found].filter(el => {
       return ![...found].some(other =>
         other !== el &&
         other.contains(el) &&
         getQuestionText(other).length > getQuestionText(el).length
       );
     });
   }


function getQuestionText(block) {
  const selectors = [
    '.topichtml',
    '.div_title_question',
    '.field-label',
    '.question-title',
    '.field-label-container',
    'legend'
  ];

  for (const selector of selectors) {
    const el = block.querySelector(selector);
    if (el && el.innerText.trim()) {
      return el.innerText.trim();
    }
  }

  // 只读取当前容器中、距离输入控件最近的题目文字，
  // 不直接使用整个外层容器的第一行文字。
  const labels = [...block.querySelectorAll('label')]
    .filter(label => label.innerText.trim());

  if (labels.length) {
    return labels[0].innerText.trim();
  }

  return '';
}


function findRule(questionText) {
  const q = normalize(questionText);
  if (!q) return null;

  // 为常见题目名称建立同义关键词
  const aliases = {
    '姓名': ['姓名', '您的姓名', '请输入您的姓名', '请输入姓名'],
    '手机号': ['手机号', '手机号码', '请输入您的手机号码', '请输入手机号', '联系电话']
  };

  const candidates = [];

  rules.forEach((rule, index) => {
    const keyword = normalize(rule.keyword);
    if (!keyword) return;

    // 只允许题干包含关键词，不允许关键词反向包含题干
    if (q.includes(keyword)) {
      candidates.push({ rule, index, score: keyword.length });
      return;
    }

    // 对预设关键词应用同义词匹配
    const key = Object.keys(aliases).find(k => normalize(k) === keyword);
    if (key && aliases[key].some(alias => q.includes(normalize(alias)))) {
      candidates.push({ rule, index, score: 100 + keyword.length });
    }
  });

  if (!candidates.length) return null;

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].rule;
}


   function dispatchChange(control) {
     control.dispatchEvent(new Event('input', { bubbles: true }));
     control.dispatchEvent(new Event('change', { bubbles: true }));
   }

   function fillQuestion(block, rule) {
     const answer = String(rule.answer ?? '');
     const controls = [...block.querySelectorAll(
       'input:not([type="hidden"]):not([type="button"]):not([type="submit"]), textarea, select'
     )].filter(el => !el.disabled && el.type !== 'file');

     if (!controls.length) {
       return { status: '未找到可填写控件', count: 0 };
     }

     const radioGroups = new Map();
     controls.filter(el => el.type === 'radio').forEach(el => {
       const key = el.name || '__radio_' + controls.indexOf(el);
       if (!radioGroups.has(key)) radioGroups.set(key, []);
       radioGroups.get(key).push(el);
     });

     let count = 0;
     const answers = answer.split(/[，,;；\n]/).map(s => s.trim()).filter(Boolean);

     for (const [groupName, group] of radioGroups) {
       const matched = group.find(el =>
         normalize(getOptionText(el)).includes(normalize(answer)) ||
         normalize(el.value) === normalize(answer)
       );
       if (matched && !matched.checked) {
         matched.click();
         count++;
       }
     }

     const checkboxes = controls.filter(el => el.type === 'checkbox');
     if (checkboxes.length) {
       for (const control of checkboxes) {
         const text = normalize(getOptionText(control));
         const value = normalize(control.value);
         const shouldCheck = answers.some(a =>
           text.includes(normalize(a)) || value === normalize(a)
         );

         if (shouldCheck && !control.checked) {
           control.click();
           count++;
         }
       }
     }

     for (const control of controls) {
       if (control.type === 'radio' || control.type === 'checkbox') continue;

       if (control.tagName === 'SELECT') {
         const option = [...control.options].find(opt =>
           normalize(opt.textContent).includes(normalize(answer)) ||
           normalize(opt.value) === normalize(answer)
         );

         if (option && control.value !== option.value) {
           control.value = option.value;
           dispatchChange(control);
           count++;
         }
       } else if (
         control.tagName === 'TEXTAREA' ||
         ['text', 'email', 'tel', 'number', 'url', 'search'].includes(control.type)
       ) {
         if (control.value !== answer) {
           control.value = answer;
           dispatchChange(control);
           count++;
         }
       }
     }

     return {
       status: count ? `已填写 ${count} 项` : '未匹配到可用选项或无需修改',
       count
     };
   }

   function scanAndFill() {
     if (!document.body) return;

     const blocks = getQuestionBlocks();
     const nextResults = [];

     for (const block of blocks) {
       const questionText = getQuestionText(block);
       const rule = findRule(questionText);

       if (!rule) {
         nextResults.push({
           question: questionText,
           answer: '',
           status: '没有匹配规则'
         });
         continue;
       }

       const result = fillQuestion(block, rule);
       nextResults.push({
         question: questionText,
         answer: String(rule.answer ?? ''),
         status: result.status
       });
     }

     results = nextResults;
     renderResults();
     updateStatus(`扫描 ${blocks.length} 道题目，匹配 ${nextResults.filter(r => r.answer).length} 条规则`);
   }

   function saveRules() {
     try {
       localStorage.setItem(RULES_KEY, JSON.stringify(rules));
       updateStatus(`已保存 ${rules.length} 条规则`);
     } catch (error) {
       console.error('[问卷填写助手] 保存规则失败：', error);
       updateStatus('保存失败，请检查浏览器存储权限');
     }
   }

   function createPanel() {
     if (!document.body || document.getElementById(PANEL_ID)) return;

     const panel = document.createElement('div');
     panel.id = PANEL_ID;

     Object.assign(panel.style, {
       position: 'fixed',
       top: '16px',
       right: '16px',
       zIndex: '2147483647',
       width: '340px',
       maxHeight: '80vh',
       overflowY: 'auto',
       padding: '14px',
       background: '#fff',
       color: '#222',
       border: '1px solid #bbb',
       borderRadius: '10px',
       boxShadow: '0 4px 18px rgba(0,0,0,.25)',
       fontSize: '13px',
       fontFamily: 'Arial, sans-serif',
       lineHeight: '1.5',
       boxSizing: 'border-box'
     });

     const heading = document.createElement('div');
     heading.textContent = `问卷星自动填写助手 v${VERSION}`;
     Object.assign(heading.style, {
       fontWeight: 'bold',
       fontSize: '15px',
       marginBottom: '10px'
     });
     panel.appendChild(heading);

     const status = document.createElement('div');
     status.id = PANEL_ID + '-status';
     status.textContent = '脚本已启动，等待扫描';
     status.style.marginBottom = '8px';
     panel.appendChild(status);

     const keywordInput = document.createElement('input');
     keywordInput.placeholder = '题目关键词';
     keywordInput.style.cssText = 'width:100%;box-sizing:border-box;margin:4px 0;padding:7px;';
     panel.appendChild(keywordInput);

     const answerInput = document.createElement('input');
     answerInput.placeholder = '预设答案';
     answerInput.style.cssText = 'width:100%;box-sizing:border-box;margin:4px 0;padding:7px;';
     panel.appendChild(answerInput);

     const buttons = document.createElement('div');
     buttons.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin:8px 0;';

     function addButton(label, handler) {
       const button = document.createElement('button');
       button.type = 'button';
       button.textContent = label;
       button.style.cssText = 'padding:6px 9px;cursor:pointer;';
       button.addEventListener('click', handler);
       buttons.appendChild(button);
     }

     addButton('添加规则', () => {
       const keyword = keywordInput.value.trim();
       const answer = answerInput.value.trim();

       if (!keyword || !answer) {
         updateStatus('请填写题目关键词和预设答案');
         return;
       }

       rules.push({ keyword, answer });
       saveRules();
       keywordInput.value = '';
       answerInput.value = '';
       renderRules();
       scanAndFill();
     });

     addButton('立即扫描填写', scanAndFill);

     addButton('保存规则', saveRules);

     addButton('导出规则', () => {
       const blob = new Blob([JSON.stringify(rules, null, 2)], {
         type: 'application/json'
       });
       const url = URL.createObjectURL(blob);
       const a = document.createElement('a');
       a.href = url;
       a.download = 'wjx-fill-rules.json';
       a.click();
       setTimeout(() => URL.revokeObjectURL(url), 1000);
     });

     panel.appendChild(buttons);

     const ruleTitle = document.createElement('div');
     ruleTitle.textContent = '预设规则';
     ruleTitle.style.fontWeight = 'bold';
     ruleTitle.style.marginTop = '8px';
     panel.appendChild(ruleTitle);

     const ruleList = document.createElement('div');
     ruleList.id = PANEL_ID + '-rules';
     panel.appendChild(ruleList);

     const resultTitle = document.createElement('div');
     resultTitle.textContent = '识别结果';
     resultTitle.style.fontWeight = 'bold';
     resultTitle.style.marginTop = '12px';
     panel.appendChild(resultTitle);

     const resultList = document.createElement('div');
     resultList.id = PANEL_ID + '-results';
     panel.appendChild(resultList);

     addButton('隐藏面板', () => {
       panel.style.display = 'none';
       const reopen = document.createElement('button');
       reopen.id = PANEL_ID + '-reopen';
       reopen.textContent = '打开填写助手';
       reopen.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;padding:9px;';
       reopen.addEventListener('click', () => {
         panel.style.display = 'block';
         reopen.remove();
       });
       document.body.appendChild(reopen);
     });

     document.body.appendChild(panel);
     renderRules();
     renderResults();
     log('面板创建成功');
   }

   function updateStatus(message) {
     const el = document.getElementById(PANEL_ID + '-status');
     if (el) el.textContent = message;
     log(message);
   }

   function renderRules() {
     const list = document.getElementById(PANEL_ID + '-rules');
     if (!list) return;

     list.replaceChildren();

     if (!rules.length) {
       const empty = document.createElement('div');
       empty.textContent = '暂无规则，请在上方添加。';
       empty.style.color = '#666';
       list.appendChild(empty);
       return;
     }

     rules.forEach((rule, index) => {
       const row = document.createElement('div');
       row.style.cssText = 'display:flex;gap:6px;align-items:start;border-top:1px solid #eee;padding:5px 0;';

       const text = document.createElement('div');
       text.style.flex = '1';
       text.textContent = `${rule.keyword} → ${rule.answer}`;

       const del = document.createElement('button');
       del.type = 'button';
       del.textContent = '删除';
       del.addEventListener('click', () => {
         rules.splice(index, 1);
         saveRules();
         renderRules();
       });

       row.append(text, del);
       list.appendChild(row);
     });
   }

   function renderResults() {
     const list = document.getElementById(PANEL_ID + '-results');
     if (!list) return;

     list.replaceChildren();

     if (!results.length) {
       const empty = document.createElement('div');
       empty.textContent = '尚未扫描到题目。';
       empty.style.color = '#666';
       list.appendChild(empty);
       return;
     }

     results.forEach(result => {
       const row = document.createElement('div');
       row.style.cssText = 'border-top:1px solid #eee;padding:6px 0;';

       const q = document.createElement('div');
       q.textContent = result.question || '(未识别题干)';
       q.style.fontWeight = 'bold';

       const a = document.createElement('div');
       a.textContent = result.answer
         ? `预设答案：${result.answer}`
         : '预设答案：无';

       const s = document.createElement('div');
       s.textContent = result.status;
       s.style.color = result.answer ? '#26733a' : '#777';

       row.append(q, a, s);
       list.appendChild(row);
     });
   }

   function start() {
     try {
       createPanel();

       if (!document.getElementById(PANEL_ID)) {
         throw new Error('面板创建失败：页面 body 不可用或面板已存在');
       }

       scanAndFill();

       if (observer) observer.disconnect();

       observer = new MutationObserver(() => {
         clearTimeout(scanTimer);
         scanTimer = setTimeout(scanAndFill, 800);
       });

       observer.observe(document.body, {
         childList: true,
         subtree: true
       });

       log(`启动成功，版本 ${VERSION}`);
     } catch (error) {
       console.error('[问卷填写助手] 启动失败：', error);
     }
   }

   if (document.readyState === 'loading') {
     document.addEventListener('DOMContentLoaded', start, { once: true });
   } else {
     start();
   }
 })();
