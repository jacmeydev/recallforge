'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Plus,
  Copy,
  Trash2,
  Pencil,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  X,
  Save,
  Eye,
  FileText,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import {
  createNoteType,
  updateNoteType,
  deleteNoteType,
  cloneNoteType,
  getNoteTypes,
} from '@/lib/services/notetype-service';
import { renderTemplate, processCloze, processClozeAnswer, generateId } from '@/lib/utils';
import type { NoteType, FieldDefinition, CardTemplate } from '@/types';

export default function NoteTypesPage() {
  const router = useRouter();
  const { user, noteTypes, setNoteTypes } = useAppStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<'fields' | 'templates' | 'preview'>('fields');

  // Edit state
  const [editName, setEditName] = useState('');
  const [editKind, setEditKind] = useState<NoteType['kind']>('basic');
  const [editFields, setEditFields] = useState<FieldDefinition[]>([]);
  const [editTemplates, setEditTemplates] = useState<CardTemplate[]>([]);
  const [editCss, setEditCss] = useState('');

  // Dialog states
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<NoteType['kind']>('basic');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  // Preview state
  const [previewFields, setPreviewFields] = useState<Record<string, string>>({});
  const [previewShowBack, setPreviewShowBack] = useState(false);

  const selectedNoteType = noteTypes.find((nt) => nt.id === selectedId);

  // Load selected note type into edit state
  useEffect(() => {
    if (selectedNoteType) {
      setEditName(selectedNoteType.name);
      setEditKind(selectedNoteType.kind);
      setEditFields([...selectedNoteType.fields]);
      setEditTemplates(selectedNoteType.templates.map((t) => ({ ...t })));
      setEditCss(selectedNoteType.css);

      // Initialize preview fields
      const pf: Record<string, string> = {};
      for (const field of selectedNoteType.fields) {
        pf[field.name] = field.name === 'Front' ? 'Ejemplo frente' :
                         field.name === 'Back' ? 'Ejemplo reverso' :
                         field.name === 'Text' ? '{{c1::cloze}} ocultamiento' :
                         field.name === 'Answer' ? 'Tokio' :
                         `Ejemplo ${field.name}`;
      }
      setPreviewFields(pf);
      setPreviewShowBack(false);
    }
  }, [selectedId, selectedNoteType]);

  const showMsg = (text: string) => {
    setMessage(text);
    setTimeout(() => setMessage(''), 3000);
  };

  const handleCreateNoteType = async () => {
    if (!user || !newName.trim()) return;

    const fields = getDefaultFields(newKind);
    const templates = getDefaultTemplates(newKind);

    await createNoteType(user.id, {
      name: newName.trim(),
      kind: newKind,
      fields: fields as Omit<FieldDefinition, 'id' | 'noteTypeId'>[],
      templates: templates as Omit<CardTemplate, 'id' | 'noteTypeId'>[],
      css: '',
    });

    const updated = await getNoteTypes(user.id);
    setNoteTypes(updated);
    setShowNewDialog(false);
    setNewName('');
    showMsg('¡Tipo de nota creado!');
  };

  const handleClone = async (id: string) => {
    if (!user) return;
    await cloneNoteType(user.id, id);
    const updated = await getNoteTypes(user.id);
    setNoteTypes(updated);
    showMsg('¡Tipo de nota clonado!');
  };

  const handleDelete = async (id: string) => {
    if (!user) return;
    if (!confirm('¿Eliminar este tipo de nota? Las notas que lo usen NO se eliminarán pero pueden quedar huérfanas.')) return;

    try {
      await deleteNoteType(id);
      const updated = await getNoteTypes(user.id);
      setNoteTypes(updated);
      if (selectedId === id) setSelectedId(null);
      showMsg('Tipo de nota eliminado');
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      showMsg(`No se puede eliminar: ${errMsg}`);
    }
  };

  const handleSave = async () => {
    if (!selectedId || !user) return;
    setSaving(true);

    try {
      await updateNoteType(user.id, selectedId, {
        name: editName,
        fields: editFields,
        templates: editTemplates,
        css: editCss,
      });

      const updated = await getNoteTypes(user.id);
      setNoteTypes(updated);
      showMsg('¡Guardado!');
    } catch (err) {
      console.error('Failed to save:', err);
      showMsg('Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  // Field operations
  const addField = () => {
    const newField: FieldDefinition = {
      id: generateId(),
      noteTypeId: selectedNoteType?.id || '',
      name: `Campo ${editFields.length + 1}`,
      ordinal: editFields.length,
      inputType: 'text',
      required: false,
      sticky: false,
      rtl: false,
      uniqueBehavior: 'none',
    };
    setEditFields([...editFields, newField]);
  };

  const removeField = (id: string) => {
    setEditFields(editFields.filter((f) => f.id !== id));
  };

  const moveField = (index: number, direction: -1 | 1) => {
    const newFields = [...editFields];
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= newFields.length) return;
    [newFields[index], newFields[targetIndex]] = [newFields[targetIndex], newFields[index]];
    newFields.forEach((f, i) => (f.ordinal = i));
    setEditFields(newFields);
  };

  const updateField = (id: string, updates: Partial<FieldDefinition>) => {
    setEditFields(editFields.map((f) => (f.id === id ? { ...f, ...updates } : f)));
  };

  // Template operations
  const addTemplate = () => {
    const newTpl = {
      id: generateId(),
      noteTypeId: selectedNoteType?.id || '',
      name: `Tarjeta ${editTemplates.length + 1}`,
      ordinal: editTemplates.length,
      frontTemplate: '',
      backTemplate: '',
      active: true,
      generationRules: {},
    } satisfies CardTemplate;
    setEditTemplates([...editTemplates, newTpl]);
  };

  const removeTemplate = (id: string) => {
    setEditTemplates(editTemplates.filter((t) => t.id !== id));
  };

  const updateTemplate = (id: string, updates: Partial<CardTemplate>) => {
    setEditTemplates(editTemplates.map((t) => (t.id === id ? { ...t, ...updates } : t)));
  };

  // Generate preview
  const renderPreview = (templateIndex: number) => {
    if (!editTemplates[templateIndex]) return { front: '', back: '' };

    const tpl = editTemplates[templateIndex];
    let front = renderTemplate(tpl.frontTemplate, previewFields);
    let back = tpl.backTemplate.replace('{{FrontSide}}', front);
    back = renderTemplate(back, previewFields);

    if (editKind === 'cloze') {
      front = processCloze(front, 1);
      back = processClozeAnswer(back, 1);
    }

    return { front, back };
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FileText className="h-6 w-6" />
          Tipos de Nota
        </h1>
        <div className="flex items-center gap-2">
          {message && <Badge variant="success">{message}</Badge>}
          <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Nuevo Tipo de Nota
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Crear Tipo de Nota</DialogTitle>
                <DialogDescription>Agrega un nuevo tipo de nota para tus tarjetas</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label>Nombre</Label>
                  <Input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Mi Tipo de Nota"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Tipo</Label>
                  <select
                    value={newKind}
                    onChange={(e) => setNewKind(e.target.value as NoteType['kind'])}
                    className="w-full rounded-md border px-3 py-2 text-sm bg-background"
                  >
                    <option value="basic">Básico</option>
                    <option value="basic_reversed">Básico (Invertido)</option>
                    <option value="cloze">Cloze</option>
                    <option value="type_answer">Escribir Respuesta</option>
                    <option value="image_occlusion">Oclusión de Imagen</option>
                  </select>
                </div>
                <Button onClick={handleCreateNoteType} disabled={!newName.trim()} className="w-full">
                  Crear
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Note type list */}
        <div className="space-y-2">
          {noteTypes.map((nt) => (
            <div
              key={nt.id}
              onClick={() => setSelectedId(nt.id)}
              className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                selectedId === nt.id ? 'border-primary bg-primary/5' : 'hover:bg-muted'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{nt.name}</p>
                  <p className="text-xs text-muted-foreground">{nt.kind} · {nt.fields.length} campos · {nt.templates.length} plantillas</p>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); handleClone(nt.id); }}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={(e) => { e.stopPropagation(); handleDelete(nt.id); }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Editor */}
        {selectedId && selectedNoteType ? (
          <div className="md:col-span-2 space-y-4">
            {/* Name */}
            <div className="flex items-center gap-3">
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="text-lg font-semibold"
              />
              <Badge>{editKind}</Badge>
              <Button onClick={handleSave} disabled={saving} size="sm">
                <Save className="h-4 w-4 mr-1" />
                {saving ? 'Guardando...' : 'Guardar'}
              </Button>
            </div>

            {/* Mode tabs */}
            <div className="flex gap-1 border-b">
              {(['fields', 'templates', 'preview'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setEditMode(tab)}
                  className={`px-4 py-2 text-sm capitalize border-b-2 transition-colors ${
                    editMode === tab
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Fields Editor */}
            {editMode === 'fields' && (
              <div className="space-y-3">
                {editFields.map((field, idx) => (
                  <div key={field.id} className="flex items-center gap-2 p-3 border rounded-lg">
                    <div className="flex flex-col gap-1">
                      <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => moveField(idx, -1)} disabled={idx === 0}>
                        <ArrowUp className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => moveField(idx, 1)} disabled={idx === editFields.length - 1}>
                        <ArrowDown className="h-3 w-3" />
                      </Button>
                    </div>
                    <Input
                      value={field.name}
                      onChange={(e) => updateField(field.id, { name: e.target.value })}
                      className="flex-1"
                    />
                    <select
                      value={field.inputType}
                      onChange={(e) => updateField(field.id, { inputType: e.target.value as FieldDefinition['inputType'] })}
                      className="rounded-md border px-2 py-1 text-sm bg-background"
                    >
                      <option value="text">Texto</option>
                      <option value="richtext">Texto Enriquecido</option>
                      <option value="image">Imagen</option>
                      <option value="audio">Audio</option>
                      <option value="video">Video</option>
                    </select>
                    <label className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={field.required}
                        onChange={(e) => updateField(field.id, { required: e.target.checked })}
                      />
                      Req
                    </label>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => removeField(field.id)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" onClick={addField}>
                  <Plus className="h-4 w-4 mr-2" />
                  Agregar Campo
                </Button>
              </div>
            )}

            {/* Template Editor */}
            {editMode === 'templates' && (
              <div className="space-y-6">
                {editTemplates.map((tpl, idx) => (
                  <Card key={tpl.id}>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <Input
                          value={tpl.name}
                          onChange={(e) => updateTemplate(tpl.id, { name: e.target.value })}
                          className="w-48 text-sm font-medium"
                        />
                        {editTemplates.length > 1 && (
                          <Button variant="ghost" size="icon" className="text-red-500" onClick={() => removeTemplate(tpl.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <Label className="text-xs">Plantilla Frontal</Label>
                        <Textarea
                          value={tpl.frontTemplate}
                          onChange={(e) => updateTemplate(tpl.id, { frontTemplate: e.target.value })}
                          rows={4}
                          className="font-mono text-sm"
                          placeholder="{{Front}}"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">Plantilla Reverso</Label>
                        <Textarea
                          value={tpl.backTemplate}
                          onChange={(e) => updateTemplate(tpl.id, { backTemplate: e.target.value })}
                          rows={6}
                          className="font-mono text-sm"
                          placeholder="{{FrontSide}}\n<hr>\n{{Back}}"
                        />
                      </div>
                    </CardContent>
                  </Card>
                ))}

                <Button variant="outline" onClick={addTemplate}>
                  <Plus className="h-4 w-4 mr-2" />
                  Agregar Plantilla
                </Button>

                {/* CSS */}
                <div className="space-y-2">
                  <Label>CSS Personalizado</Label>
                  <Textarea
                    value={editCss}
                    onChange={(e) => setEditCss(e.target.value)}
                    rows={6}
                    className="font-mono text-sm"
                    placeholder=".card { font-family: sans-serif; }"
                  />
                </div>
              </div>
            )}

            {/* Preview */}
            {editMode === 'preview' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  {editFields.map((field) => (
                    <div key={field.id} className="space-y-1">
                      <Label className="text-xs">{field.name}</Label>
                      <Input
                        value={previewFields[field.name] || ''}
                        onChange={(e) => setPreviewFields((p) => ({ ...p, [field.name]: e.target.value }))}
                        className="text-sm"
                      />
                    </div>
                  ))}
                </div>

                {editTemplates.map((tpl, idx) => {
                  const { front, back } = renderPreview(idx);
                  return (
                    <Card key={tpl.id}>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">{tpl.name}</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="border rounded-lg p-6 study-card">
                          <style dangerouslySetInnerHTML={{ __html: editCss }} />
                          <div
                            className="prose prose-sm dark:prose-invert max-w-none"
                            dangerouslySetInnerHTML={{ __html: front }}
                          />
                          {previewShowBack && (
                            <>
                              <hr className="my-4 border-border" />
                              <div
                                className="prose prose-sm dark:prose-invert max-w-none"
                                dangerouslySetInnerHTML={{ __html: back }}
                              />
                            </>
                          )}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-3"
                          onClick={() => setPreviewShowBack(!previewShowBack)}
                        >
                          <Eye className="h-3.5 w-3.5 mr-1" />
                          {previewShowBack ? 'Ocultar Reverso' : 'Mostrar Reverso'}
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="md:col-span-2 flex items-center justify-center min-h-75 text-muted-foreground">
            <p>Selecciona un tipo de nota para editar</p>
          </div>
        )}
      </div>
    </div>
  );
}

function getDefaultFields(kind: NoteType['kind']): Omit<FieldDefinition, 'noteTypeId'>[] {
  const base = { sticky: false, rtl: false, uniqueBehavior: 'none' as const };
  switch (kind) {
    case 'basic':
    case 'basic_reversed':
      return [
        { id: generateId(), name: 'Front', ordinal: 0, inputType: 'richtext', required: true, ...base },
        { id: generateId(), name: 'Back', ordinal: 1, inputType: 'richtext', required: false, ...base },
      ];
    case 'cloze':
      return [
        { id: generateId(), name: 'Text', ordinal: 0, inputType: 'richtext', required: true, ...base },
        { id: generateId(), name: 'Extra', ordinal: 1, inputType: 'richtext', required: false, ...base },
      ];
    case 'type_answer':
      return [
        { id: generateId(), name: 'Front', ordinal: 0, inputType: 'richtext', required: true, ...base },
        { id: generateId(), name: 'Answer', ordinal: 1, inputType: 'text', required: true, ...base },
      ];
    case 'image_occlusion':
      return [
        { id: generateId(), name: 'Image', ordinal: 0, inputType: 'image', required: true, ...base },
        { id: generateId(), name: 'Header', ordinal: 1, inputType: 'text', required: false, ...base },
        { id: generateId(), name: 'Extra', ordinal: 2, inputType: 'richtext', required: false, ...base },
      ];
    default:
      return [
        { id: generateId(), name: 'Front', ordinal: 0, inputType: 'text', required: true, ...base },
        { id: generateId(), name: 'Back', ordinal: 1, inputType: 'text', required: false, ...base },
      ];
  }
}

function getDefaultTemplates(kind: NoteType['kind']): Omit<CardTemplate, 'noteTypeId' | 'active' | 'generationRules'>[] {
  switch (kind) {
    case 'basic':
      return [{
        id: generateId(), name: 'Card 1', ordinal: 0,
        frontTemplate: '{{Front}}',
        backTemplate: '{{FrontSide}}\n<hr>\n{{Back}}',
      }];
    case 'basic_reversed':
      return [
        { id: generateId(), name: 'Card 1', ordinal: 0, frontTemplate: '{{Front}}', backTemplate: '{{FrontSide}}\n<hr>\n{{Back}}' },
        { id: generateId(), name: 'Card 2', ordinal: 1, frontTemplate: '{{Back}}', backTemplate: '{{FrontSide}}\n<hr>\n{{Front}}' },
      ];
    case 'cloze':
      return [{
        id: generateId(), name: 'Cloze', ordinal: 0,
        frontTemplate: '{{Text}}',
        backTemplate: '{{Text}}\n<br>\n{{Extra}}',
      }];
    case 'type_answer':
      return [{
        id: generateId(), name: 'Card 1', ordinal: 0,
        frontTemplate: '{{Front}}\n{{type:Answer}}',
        backTemplate: '{{FrontSide}}\n<hr>\n{{Answer}}',
      }];
    case 'image_occlusion':
      return [{
        id: generateId(), name: 'Card 1', ordinal: 0,
        frontTemplate: '{{Header}}\n<img src="{{Image}}">',
        backTemplate: '{{FrontSide}}\n<hr>\n<img src="{{Image}}">\n{{Extra}}',
      }];
    default:
      return [{
        id: generateId(), name: 'Card 1', ordinal: 0,
        frontTemplate: '{{Front}}',
        backTemplate: '{{FrontSide}}\n<hr>\n{{Back}}',
      }];
  }
}
