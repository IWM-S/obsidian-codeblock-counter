const { Plugin } = require('obsidian');

module.exports = class CodeblockCharCountPlugin extends Plugin {
  async onload() {
    // 1. 閲覧モード (Reading View) 用の処理
    this.registerMarkdownPostProcessor((element) => {
      const codeBlocks = element.querySelectorAll('pre > code');
      codeBlocks.forEach((codeEl) => {
        const preEl = codeEl.parentElement;
        if (!preEl || preEl.querySelector('.codeblock-char-count')) return;

        const rawText = codeEl.textContent || '';
        const text = rawText.replace(/\s+/g, '');
        const count = text.length;

        const badge = document.createElement('span');
        badge.className = 'codeblock-char-count';
        badge.textContent = String(count);
        preEl.appendChild(badge);
      });
    });

    // 2. 編集モード (Live Preview / Source Mode) 用の処理
    try {
      const { ViewPlugin, Decoration, WidgetType, EditorView } = require('@codemirror/view');
      const { RangeSetBuilder } = require('@codemirror/state');

      class CharCountWidget extends WidgetType {
        constructor(count) {
          super();
          this.count = count;
        }
        toDOM() {
          const span = document.createElement('span');
          span.className = 'cm-codeblock-char-count';
          span.textContent = String(this.count);
          return span;
        }
        eq(other) {
          return other.count === this.count;
        }
      }

      // 文字数表示プラグイン
      const codeblockCountPlugin = ViewPlugin.fromClass(
        class {
          constructor(view) {
            this.decorations = this.buildDecorations(view);
          }
          update(update) {
            if (update.docChanged || update.viewportChanged) {
              this.decorations = this.buildDecorations(update.view);
            }
          }
          buildDecorations(view) {
            const builder = new RangeSetBuilder();
            const doc = view.state.doc;
            let inCodeBlock = false;
            let fenceMarker = '';
            let startLineEnd = 0;
            let charCount = 0;

            for (let i = 1; i <= doc.lines; i++) {
              const line = doc.line(i);
              const text = line.text;
              const trimmed = text.trimStart();

              if (!inCodeBlock) {
                const match = trimmed.match(/^(`{3,}|~{3,})/);
                if (match) {
                  inCodeBlock = true;
                  fenceMarker = match[1];
                  startLineEnd = line.to;
                  charCount = 0;
                }
              } else {
                const closeRegex = new RegExp(`^${fenceMarker[0]}{${fenceMarker.length},}\\s*$`);
                if (closeRegex.test(trimmed)) {
                  builder.add(
                    startLineEnd,
                    startLineEnd,
                    Decoration.widget({
                      widget: new CharCountWidget(charCount),
                      side: 1,
                    })
                  );
                  inCodeBlock = false;
                  fenceMarker = '';
                } else {
                  charCount += text.replace(/\s+/g, '').length;
                }
              }
            }
            return builder.finish();
          }
        },
        {
          decorations: (v) => v.decorations,
        }
      );

      // カーソル直前の「‘‘‘」「’’’」「｀｀｀」をコードブロックへ置換する共通関数
      const tryExpandImeCodeblock = (view) => {
        if (view.composing) return;

        const state = view.state;
        const sel = state.selection.main;
        if (!sel.empty) return;

        const pos = sel.head;
        const line = state.doc.lineAt(pos);
        const textBeforeCursor = line.text.slice(0, pos - line.from);

        const match = textBeforeCursor.match(/^(\s*)([‘’｀]{3})$/);
        if (match) {
          const indent = match[1];
          const replaceFrom = pos - 3;
          const insertText = '```\n' + indent + '```';

          view.dispatch({
            changes: {
              from: replaceFrom,
              to: pos,
              insert: insertText,
            },
            selection: { anchor: replaceFrom + 3 },
          });
        }
      };

      // IME確定イベント (compositionend) 完了直後にチェック
      const imeCompositionHandler = EditorView.domEventHandlers({
        compositionend(_event, view) {
          setTimeout(() => {
            tryExpandImeCodeblock(view);
          }, 0);
        },
      });

      // 確定と同時にドキュメント更新が走るIME環境向けのフォールバック
      const imeUpdateListener = EditorView.updateListener.of((update) => {
        if (!update.docChanged || update.view.composing) return;
        const isUserInput = update.transactions.some((tr) => tr.isUserEvent('input'));
        if (!isUserInput) return;

        setTimeout(() => {
          tryExpandImeCodeblock(update.view);
        }, 0);
      });

      this.registerEditorExtension([
        codeblockCountPlugin,
        imeCompositionHandler,
        imeUpdateListener,
      ]);
    } catch (e) {
      console.warn('CodeblockCharCountPlugin: Editor extension failed to load', e);
    }
  }
};