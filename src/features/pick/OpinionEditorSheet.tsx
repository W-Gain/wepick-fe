import * as AlertDialog from '@radix-ui/react-alert-dialog';
import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef, useState } from 'react';

import type { Choice } from '../../shared/contracts';
import { Button, CloseIcon, useToast } from '../../shared/ui';

type OpinionEditorSheetProps = {
  open: boolean;
  mode: 'create' | 'edit';
  choice: Choice;
  optionLabel: string;
  initialBody?: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (body: string) => Promise<void> | void;
};

type OpenOpinionEditorProps = Omit<OpinionEditorSheetProps, 'open'>;

function OpenOpinionEditor({
  mode,
  choice,
  optionLabel,
  initialBody = '',
  onOpenChange,
  onSubmit,
}: OpenOpinionEditorProps) {
  const [body, setBody] = useState(initialBody);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { clear, setSuspended } = useToast();
  const normalizedBody = body.trim();
  const bodyCodePointCount = [...body].length;
  const dirty = body !== initialBody;
  const valid = normalizedBody.length > 0 && bodyCodePointCount <= 300;

  useEffect(() => {
    clear();
    setSuspended(true);
    return () => setSuspended(false);
  }, [clear, setSuspended]);

  function requestClose() {
    if (submitting) return;
    if (dirty) {
      setDiscardOpen(true);
      return;
    }
    onOpenChange(false);
  }

  async function submit() {
    if (!valid || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(normalizedBody);
      onOpenChange(false);
    } catch {
      setSubmitError('의견을 반영하지 못했어요. 입력한 내용은 그대로 유지돼요.');
      setSubmitting(false);
      inputRef.current?.focus();
    }
  }

  return (
    <>
      <Dialog.Root open onOpenChange={(nextOpen) => !nextOpen && requestClose()}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content
            className="sheet-content opinion-editor-sheet"
            aria-describedby="opinion-editor-help"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              inputRef.current?.focus();
            }}
          >
            <div className="sheet-content__handle" aria-hidden="true" />
            <header className="sheet-content__header opinion-editor__header">
              <Dialog.Title>{mode === 'create' ? '의견 남기기' : '의견 수정'}</Dialog.Title>
              <button
                className="icon-button"
                type="button"
                aria-label="닫기"
                onClick={requestClose}
              >
                <CloseIcon />
              </button>
            </header>

            <div
              className="opinion-editor__choice"
              aria-label={`내 선택 ${choice}, ${optionLabel}`}
            >
              <span
                className={`opinion-editor__choice-badge opinion-editor__choice-badge--${choice.toLowerCase()}`}
              >
                {choice}
              </span>
              <span>내 선택 · {optionLabel}</span>
            </div>

            <label className="opinion-editor__field">
              <span>선택한 이유를 남겨주세요</span>
              <textarea
                ref={inputRef}
                value={body}
                disabled={submitting}
                placeholder="왜 이 선택을 골랐나요?"
                aria-describedby={`opinion-editor-count opinion-editor-help${submitError ? ' opinion-editor-error' : ''}`}
                aria-invalid={Boolean(submitError)}
                onChange={(event) => {
                  setBody(event.target.value);
                  setSubmitError(null);
                }}
              />
            </label>
            <output id="opinion-editor-count" className="opinion-editor__count" aria-live="polite">
              {bodyCodePointCount} / 300
            </output>
            {submitError && (
              <p id="opinion-editor-error" className="opinion-editor__error" role="alert">
                {submitError}
              </p>
            )}
            <p id="opinion-editor-help" className="opinion-editor__help">
              서로의 선택을 존중하는 의견을 남겨주세요.
            </p>

            <div className="opinion-editor__actions">
              <Button variant="secondary" disabled={submitting} onClick={requestClose}>
                취소
              </Button>
              <Button disabled={!valid || submitting} onClick={submit}>
                {submitting ? '반영 중…' : mode === 'create' ? '등록' : '저장'}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <AlertDialog.Root open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="dialog-overlay dialog-overlay--nested" />
          <AlertDialog.Content className="confirm-dialog confirm-dialog--nested">
            <AlertDialog.Title>작성 중인 내용을 버릴까요?</AlertDialog.Title>
            <AlertDialog.Description>입력한 의견은 저장되지 않고 사라져요.</AlertDialog.Description>
            <div className="confirm-dialog__actions">
              <AlertDialog.Cancel asChild>
                <Button variant="secondary" size="medium">
                  계속 작성
                </Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <Button size="medium" onClick={() => onOpenChange(false)}>
                  버리기
                </Button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}

export function OpinionEditorSheet({ open, ...props }: OpinionEditorSheetProps) {
  return open ? <OpenOpinionEditor {...props} /> : null;
}
