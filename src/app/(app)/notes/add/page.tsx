'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft,
  Plus,
  X,
  ChevronDown,
  Save,
  AlertTriangle,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { createNote, updateNote, getNote, findDuplicates } from '@/lib/services/note-service';
import { ImageOcclusionEditor, serializeMasks, deserializeMasks } from '@/components/image-occlusion-editor';
import type { IORect } from '@/components/image-occlusion-editor';
import {
  renderTemplate,
  processCloze,
  processClozeAnswer,
  extractClozeIndices,
  sanitizeHtml,
  processIOFront,
  processIOBack,
} from '@/lib/utils';
import type { NoteType, Deck } from '@/types';

export default function AddNotePage() {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">Cargando...</div>}>
      <AddNoteContent />
    </Suspense>
  );
}

function AddNoteContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get('edit');

  const { user, decks, noteTypes } = useAppStore();

  const [selectedDeckId, setSelectedDeckId] = useState<string>('');
  const [selectedNoteTypeId, setSelectedNoteTypeId] = useState<string>('');
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState('');
  const [showDeckPicker, setShowDeckPicker] = useState(false);
  const [showNoteTypePicker, setShowNoteTypePicker] = useState(false);
  const [ioMasks, setIoMasks] = useState<IORect[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [previewSide, setPreviewSide] = useState<'front' | 'back'>('front');
  const [previewCardIndex, setPreviewCardIndex] = useState(0);

  const selectedNoteType = useMemo(
    () => noteTypes.find((nt) => nt.id === selectedNoteTypeId),
    [noteTypes, selectedNoteTypeId]
  );

  // Initialize defaults
  useEffect(() => {
    if (decks.length > 0 && !selectedDeckId) {
      setSelectedDeckId(decks[0].id);
    }
    if (noteTypes.length > 0 && !selectedNoteTypeId) {
      setSelectedNoteTypeId(noteTypes[0].id);
    }
  }, [decks, noteTypes, selectedDeckId, selectedNoteTypeId]);

  // Initialize fields when note type changes
  useEffect(() => {
    if (selectedNoteType && !editId) {
      const initial: Record<string, string> = {};
      for (const field of selectedNoteType.fields) {
        initial[field.name] = '';
      }
      setFieldValues(initial);
      setIoMasks([]);
    }
  }, [editId, selectedNoteType, selectedNoteType?.fields]);

  // Load note for editing
  useEffect(() => {
    async function loadNote() {
      if (!editId || !user) return;
      const note = await getNote(editId);
      if (note) {
        setSelectedDeckId(note.deckId);
        setSelectedNoteTypeId(note.noteTypeId);
        setFieldValues(note.fieldValues);
        setTags(note.tags);
        // Restore IO masks from saved JSON
        if (note.fieldValues['Masks']) {
          try { setIoMasks(deserializeMasks(note.fieldValues['Masks'])); } catch { /* ignore */ }
        }
      }
    }
    loadNote();
  }, [editId, user]);

  // Duplicate check
  useEffect(() => {
    async function checkDuplicates() {
      if (!user || !selectedNoteTypeId || !selectedDeckId) return;

      const firstField = selectedNoteType?.fields[0]?.name;
      if (!firstField || !fieldValues[firstField]?.trim()) {
        setDuplicateWarning('');
        return;
      }

      const dupes = await findDuplicates(
        user.id,
        fieldValues
      );

      if (dupes.length > 0) {
        setDuplicateWarning(`${dupes.length} posible(s) duplicado(s) encontrado(s)`);
      } else {
        setDuplicateWarning('');
      }
    }

    const timer = setTimeout(checkDuplicates, 500);
    return () => clearTimeout(timer);
  }, [fieldValues, selectedDeckId, selectedNoteType, selectedNoteTypeId, user]);

  const handleFieldChange = (fieldName: string, value: string) => {
    setFieldValues((prev) => ({ ...prev, [fieldName]: value }));
    setSaved(false);
  };

  const handleAddTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (tag && !tags.includes(tag)) {
      setTags((prev) => [...prev, tag]);
    }
    setTagInput('');
  };

  const handleRemoveTag = (tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  };

  const handleSave = async () => {
    if (!user || !selectedDeckId || !selectedNoteTypeId || !selectedNoteType) return;

    // Validate required fields
    if (selectedNoteType.kind === 'image_occlusion') {
      if (!fieldValues['Image']) return; // Need an image
    } else {
      const firstField = selectedNoteType.fields[0];
      if (firstField && !fieldValues[firstField.name]?.trim()) return;
    }

    setSaving(true);
    try {
      if (editId) {
        await updateNote(user.id, editId, {
          deckId: selectedDeckId,
          fieldValues,
          tags,
        });
      } else {
        await createNote(user.id, {
          deckId: selectedDeckId,
          noteTypeId: selectedNoteTypeId,
          fieldValues,
          tags,
        });
      }

      if (editId) {
        router.back();
      } else {
        // Reset for another note
        const initial: Record<string, string> = {};
        for (const field of selectedNoteType.fields) {
          initial[field.name] = '';
        }
        setFieldValues(initial);
        setTags([]);
        setIoMasks([]);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch (err) {
      console.error('Failed to save note:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    }
  };

  // ─── Preview rendering ──────────────────────────────────────────────

  const previewCardCount = useMemo(() => {
    if (!selectedNoteType) return 0;
    if (selectedNoteType.kind === 'image_occlusion') return ioMasks.length || 0;
    if (selectedNoteType.kind === 'cloze') {
      const text = fieldValues['Text'] || '';
      return extractClozeIndices(text).length || 0;
    }
    return selectedNoteType.templates.filter(t => t.active !== false).length;
  }, [selectedNoteType, fieldValues, ioMasks]);

  const previewHtml = useMemo(() => {
    if (!selectedNoteType || !showPreview) return { front: '', back: '' };
    const kind = selectedNoteType.kind;

    // Image Occlusion
    if (kind === 'image_occlusion') {
      if (!fieldValues['Image'] || ioMasks.length === 0) {
        return { front: '<p style="opacity:0.5;text-align:center">Agrega una imagen y al menos una zona</p>', back: '' };
      }
      const idx = Math.min(previewCardIndex, ioMasks.length - 1);
      const masksJson = serializeMasks(ioMasks);
      const header = fieldValues['Header'] || '';
      const extra = fieldValues['Extra'] || '';
      const headerHtml = header ? `<div class="io-header">${sanitizeHtml(header)}</div>` : '';
      const extraHtml = extra ? `<div class="extra">${sanitizeHtml(extra)}</div>` : '';
      return {
        front: headerHtml + processIOFront(fieldValues['Image'], masksJson, idx),
        back: headerHtml + processIOBack(fieldValues['Image'], masksJson, idx) + extraHtml,
      };
    }

    // Cloze
    if (kind === 'cloze') {
      const text = fieldValues['Text'] || '';
      const indices = extractClozeIndices(text);
      if (indices.length === 0) {
        return { front: '<p style="opacity:0.5;text-align:center">Escribe texto con {{c1::...}} para ver la vista previa</p>', back: '' };
      }
      const clozeIdx = indices[Math.min(previewCardIndex, indices.length - 1)];
      const template = selectedNoteType.templates[0];
      if (!template) return { front: '', back: '' };
      let frontHtml = renderTemplate(template.frontTemplate, fieldValues);
      frontHtml = processCloze(frontHtml, clozeIdx);
      let backHtml = template.backTemplate.replace('{{FrontSide}}', '');
      backHtml = renderTemplate(backHtml, fieldValues);
      backHtml = processClozeAnswer(backHtml, clozeIdx);
      return { front: sanitizeHtml(frontHtml), back: sanitizeHtml(backHtml) };
    }

    // Basic, basic_reversed, type_answer, custom
    const templates = selectedNoteType.templates.filter(t => t.active !== false);
    const tpl = templates[Math.min(previewCardIndex, templates.length - 1)];
    if (!tpl) return { front: '', back: '' };
    const frontHtml = sanitizeHtml(renderTemplate(tpl.frontTemplate, fieldValues));
    let backHtml = tpl.backTemplate.replace('{{FrontSide}}', '');
    backHtml = sanitizeHtml(renderTemplate(backHtml, fieldValues));
    return { front: frontHtml, back: backHtml };
  }, [selectedNoteType, fieldValues, ioMasks, showPreview, previewCardIndex]);

  return (
    <div className="max-w-2xl mx-auto space-y-6" onKeyDown={handleKeyDown}>
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-2xl font-bold">{editId ? 'Editar Nota' : 'Agregar Nota'}</h1>
        {saved && (
          <Badge variant="success" className="ml-auto">
            ¡Guardado!
          </Badge>
        )}
      </div>

      {/* Deck & Note Type selectors */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Mazo</Label>
          <div className="relative">
            <button
              onClick={() => setShowDeckPicker(!showDeckPicker)}
              className="w-full flex items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-muted"
            >
              <span>{decks.find((d) => d.id === selectedDeckId)?.name || 'Seleccionar mazo...'}</span>
              <ChevronDown className="h-4 w-4" />
            </button>
            {showDeckPicker && (
              <div className="absolute z-10 mt-1 w-full bg-popover border rounded-md shadow-lg max-h-60 overflow-auto">
                {decks.filter((d) => !d.archived).map((deck) => (
                  <button
                    key={deck.id}
                    onClick={() => {
                      setSelectedDeckId(deck.id);
                      setShowDeckPicker(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-muted ${
                      deck.id === selectedDeckId ? 'bg-primary/10 font-medium' : ''
                    }`}
                  >
                    {deck.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label>Tipo de Nota</Label>
          <div className="relative">
            <button
              onClick={() => setShowNoteTypePicker(!showNoteTypePicker)}
              className="w-full flex items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-muted"
              disabled={!!editId}
            >
              <span>{selectedNoteType?.name || 'Seleccionar tipo...'}</span>
              <ChevronDown className="h-4 w-4" />
            </button>
            {showNoteTypePicker && !editId && (
              <div className="absolute z-10 mt-1 w-full bg-popover border rounded-md shadow-lg max-h-60 overflow-auto">
                {noteTypes.map((nt) => (
                  <button
                    key={nt.id}
                    onClick={() => {
                      setSelectedNoteTypeId(nt.id);
                      setShowNoteTypePicker(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-muted ${
                      nt.id === selectedNoteTypeId ? 'bg-primary/10 font-medium' : ''
                    }`}
                  >
                    <span>{nt.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">({nt.kind})</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Duplicate warning */}
      {duplicateWarning && (
        <div className="flex items-center gap-2 p-3 text-sm bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 rounded-lg border border-yellow-500/20">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {duplicateWarning}
        </div>
      )}

      {/* Fields */}
      {selectedNoteType && selectedNoteType.kind === 'image_occlusion' ? (
        <>
          {/* IO Editor */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Imagen y Zonas de Oclusión</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <ImageOcclusionEditor
                imageDataUrl={fieldValues['Image'] || ''}
                masks={ioMasks}
                onImageChange={(dataUrl) => handleFieldChange('Image', dataUrl)}
                onMasksChange={(newMasks) => {
                  setIoMasks(newMasks);
                  handleFieldChange('Masks', serializeMasks(newMasks));
                }}
              />
              {ioMasks.length === 0 && fieldValues['Image'] && (
                <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Dibuja al menos una zona para crear tarjetas
                </p>
              )}
            </CardContent>
          </Card>

          {/* Header & Extra */}
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="io-header">Título <span className="text-muted-foreground font-normal">(opcional)</span></Label>
                <Input
                  id="io-header"
                  placeholder="Ej: Anatomía del corazón..."
                  value={fieldValues['Header'] || ''}
                  onChange={(e) => handleFieldChange('Header', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="io-extra">Nota extra <span className="text-muted-foreground font-normal">(opcional)</span></Label>
                <Textarea
                  id="io-extra"
                  placeholder="Información adicional que aparecerá al revelar..."
                  value={fieldValues['Extra'] || ''}
                  onChange={(e) => handleFieldChange('Extra', e.target.value)}
                  rows={3}
                  className="text-sm"
                />
              </div>
            </CardContent>
          </Card>
        </>
      ) : selectedNoteType && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            {selectedNoteType.fields.map((field, idx) => (
              <div key={field.id} className="space-y-2">
                <Label htmlFor={field.id}>
                  {field.name}
                  {idx === 0 && <span className="text-red-500 ml-1">*</span>}
                </Label>
                {field.inputType === 'richtext' || field.inputType === 'text' ? (
                  <Textarea
                    id={field.id}
                  placeholder={`Ingresa ${field.name.toLowerCase()}...`}
                  value={fieldValues[field.name] || ''}
                  onChange={(e) => handleFieldChange(field.name, e.target.value)}
                  rows={field.name.toLowerCase().includes('back') ||
                        field.name.toLowerCase().includes('answer') ||
                        field.name.toLowerCase().includes('extra') ? 4 : 3}
                  className="font-mono text-sm"
                />
                ) : field.inputType === 'image' ? (
                  <Input
                    id={field.id}
                    type="url"
                    placeholder="URL de imagen..."
                    value={fieldValues[field.name] || ''}
                    onChange={(e) => handleFieldChange(field.name, e.target.value)}
                  />
                ) : (
                  <Input
                    id={field.id}
                    placeholder={`Ingresa ${field.name.toLowerCase()}...`}
                    value={fieldValues[field.name] || ''}
                    onChange={(e) => handleFieldChange(field.name, e.target.value)}
                  />
                )}
                {selectedNoteType.kind === 'cloze' && field.name === 'Text' && (
                  <p className="text-xs text-muted-foreground">
                    Usa {'{{c1::respuesta}}'} para ocultamiento cloze. Usa c2, c3... para múltiples clozes.
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Tags */}
      <Card>
        <CardContent className="pt-6 space-y-3">
          <Label>Etiquetas</Label>
          <div className="flex flex-wrap gap-2 min-h-8">
            {tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="flex items-center gap-1">
                {tag}
                <button onClick={() => handleRemoveTag(tag)}>
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="Agregar etiqueta..."
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddTag();
                }
              }}
              className="flex-1"
            />
            <Button variant="outline" size="sm" onClick={handleAddTag}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Preview */}
      {selectedNoteType && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setShowPreview(!showPreview)}
                className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors"
              >
                {showPreview ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                Vista previa
              </button>
              {showPreview && previewCardCount > 1 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    Tarjeta {Math.min(previewCardIndex + 1, previewCardCount)} de {previewCardCount}
                  </span>
                  <div className="flex gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-6 w-6"
                      disabled={previewCardIndex === 0}
                      onClick={() => setPreviewCardIndex(i => i - 1)}
                    >
                      <ChevronDown className="h-3 w-3 rotate-90" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-6 w-6"
                      disabled={previewCardIndex >= previewCardCount - 1}
                      onClick={() => setPreviewCardIndex(i => i + 1)}
                    >
                      <ChevronDown className="h-3 w-3 -rotate-90" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </CardHeader>
          {showPreview && (
            <CardContent className="space-y-4">
              {/* Side toggle */}
              <div className="flex gap-1 p-0.5 bg-muted rounded-lg w-fit">
                <button
                  onClick={() => setPreviewSide('front')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    previewSide === 'front' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Frente
                </button>
                <button
                  onClick={() => setPreviewSide('back')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    previewSide === 'back' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Reverso
                </button>
              </div>

              {/* Preview content */}
              <div className="study-card rounded-xl border bg-card p-6 min-h-30 flex items-center justify-center">
                {(previewSide === 'front' ? previewHtml.front : previewHtml.back) ? (
                  <div
                    className="w-full"
                    dangerouslySetInnerHTML={{
                      __html: previewSide === 'front' ? previewHtml.front : previewHtml.back,
                    }}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {previewSide === 'front' ? 'Completa los campos para ver la vista previa' : 'Sin contenido en el reverso'}
                  </p>
                )}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pb-8">
        <p className="text-xs text-muted-foreground">Ctrl+Enter para guardar</p>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => router.back()}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4 mr-2" />
            {saving ? 'Guardando...' : editId ? 'Actualizar Nota' : 'Agregar Nota'}
          </Button>
        </div>
      </div>
    </div>
  );
}
