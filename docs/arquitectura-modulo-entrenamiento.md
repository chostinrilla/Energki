# Arquitectura del modulo de entrenamiento

## Objetivo

Integrar el editor de planos y el visor como un modulo independiente de la plataforma principal. El modulo debe poder empezar con Google Sheets y Google Drive, pero el frontend no debe conocer ninguno de los dos.

La frontera principal es:

```text
Panel principal -> API/servicios -> repositorios -> Google Sheets / Google Drive
                         |
                         +-> contrato ManualContent -> Editor y Visor
```

El objeto `manualData` actual es el punto de partida del contrato. El visor debe recibir datos, no buscar elementos HTML por IDs ni leer directamente una hoja.

## Estructura propuesta

```text
training-module/
  apps/
    dashboard/             # listado, filtros, estado y acceso a editor/visor
    editor/                 # imagen, pines, metadatos y exportacion
    viewer/                 # reproduccion y navegacion del entrenamiento
  packages/
    domain/                 # tipos, validaciones y reglas sin infraestructura
    contracts/              # ManualContent, DTOs de API y versiones de contrato
    services/               # casos de uso: listar, guardar, publicar, cargar
    adapters/               # transformadores entre contrato y UI existente
  server/
    routes/                 # HTTP; autentica y valida, no contiene reglas de Sheets
    repositories/           # interfaces + implementacion Google Sheets/Drive
  docs/
  contracts/
```

Para la primera etapa no hace falta separar aplicaciones en repositorios distintos. Pueden ser tres vistas dentro de una misma aplicación y compartir `domain`, `contracts` y `services`.

## Responsabilidad de cada capa

### Dominio

Define `ManualContent`, valida coordenadas, IDs, orden de pasos y referencias de imagen. No importa SDKs de Google ni conoce HTTP.

### Servicios

Expone casos de uso pequeños:

- `listTrainings(filters)`
- `getTraining(id)`
- `saveDraft(manual)`
- `publishTraining(id)`
- `uploadTrainingImage(file)`

Estos casos de uso dependen de interfaces como `TrainingRepository` y `AssetStorage`. Cambiar Sheets por MySQL solo cambia los adaptadores.

### API

El servidor valida entrada, autoriza al usuario y llama a servicios. Una API inicial puede ser:

```text
GET    /api/v1/trainings
GET    /api/v1/trainings/:id
POST   /api/v1/trainings
PUT    /api/v1/trainings/:id
POST   /api/v1/trainings/:id/publish
POST   /api/v1/assets
```

El frontend nunca usa URLs, tokens o IDs de Sheets/Drive. La API devuelve el contrato normalizado y URLs de lectura de imágenes.

### Persistencia inicial

Google Sheets funciona como repositorio, no como API pública del navegador:

- Hoja `trainings`: `id`, `title`, `status`, `version`, `updated_at`, `owner_id`, `content_json`.
- Hoja `assets`: `id`, `training_id`, `drive_file_id`, `kind`, `mime_type`, `created_at`.
- Google Drive guarda los binarios. La aplicación conserva solo `assetId` y metadatos controlados.

Guardar el contenido completo en `content_json` permite arrancar rápido. Si el tamaño o las consultas crecen, el adaptador MySQL puede normalizar tablas sin cambiar el contrato HTTP. No se deben usar fórmulas ni nombres de celdas como contrato del sistema.

## Contrato editor / visor

El contrato canónico está en `contracts/manual.schema.json`. Mantiene los campos existentes:

```json
{
  "schemaVersion": "1.0",
  "id": "manual-123",
  "status": "draft",
  "configuracion": { "instructor": "Mateo", "empresa": "Energki Robotics" },
  "canvas": { "assetId": "asset-456", "width": 1600, "height": 900 },
  "paneles": [
    { "id": "panel-1", "color": "#e53935", "origen": { "x": 32.4, "y": 48.1 }, "narrativa": "..." }
  ],
  "steps": [
    { "id": "step-1", "order": 1, "text": "...", "panelIds": ["panel-1"] }
  ]
}
```

Las coordenadas son porcentajes de `0` a `100`, igual que el editor actual. El visor usa `panelIds` y `order`, no selectores CSS. El campo `steps` es opcional durante la migración: si falta, un adaptador puede crear un paso por cada elemento de `paneles`, permitiendo que el JSON existente siga siendo válido.

Reglas del contrato:

- `schemaVersion` cambia solo con una migración explícita.
- `id` identifica el manual; `version` identifica una revisión publicada.
- `assetId` referencia una imagen gestionada por la API, nunca un `drive_file_id` expuesto al navegador.
- El editor puede guardar `draft`; el visor público solo carga `published`.
- El visor debe tolerar campos adicionales y rechazar versiones incompatibles con un error claro.

## Puente con la plataforma del CEO

Mantener un `PlatformGateway` opcional detrás de servicios:

```ts
interface PlatformGateway {
  getCurrentUser(): Promise<{ id: string; roles: string[] }>;
  notifyTrainingPublished(input: { trainingId: string; version: number }): Promise<void>;
}
```

Al inicio se implementa `NoopPlatformGateway` y el módulo usa autenticación local o un usuario de desarrollo. Más adelante se agrega un adaptador para el SSO o API de la plataforma principal. Así el editor y visor no cambian cuando cambien login, permisos o navegación externa.

## Flujo recomendado

1. El editor pide una URL de carga a `POST /api/v1/assets`.
2. El servidor valida el archivo y lo sube a Drive mediante `AssetStorage`.
3. El editor guarda el `ManualContent` como borrador mediante `PUT /api/v1/trainings/:id`.
4. El servidor valida y persiste la versión en el repositorio configurado.
5. Publicar crea una versión inmutable y emite una notificación al `PlatformGateway`.
6. El visor solicita `GET /api/v1/trainings/:id` y renderiza desde el contrato.

## Migración en etapas

### Etapa 1: separar el contrato

Extraer `manualData`, `steps` y la lógica de reproducción a módulos. Añadir un adaptador que convierta el JSON actual al contrato versionado.

### Etapa 2: API mínima

Crear el servidor con repositorios `TrainingRepository` y `AssetStorage`. Implementar Sheets/Drive y pruebas de contrato. El frontend solo consume `/api/v1`.

### Etapa 3: persistencia intercambiable

Implementar `MySqlTrainingRepository` detrás de la misma interfaz. Ejecutar una migración de datos y comparar lecturas antes de cambiar el adaptador activo.

### Etapa 4: integración externa

Activar `PlatformGateway` real para usuario, permisos, menú y notificaciones de publicación.

## Decisiones deliberadamente simples

- Un contrato JSON canónico, en lugar de duplicar modelos para editor y visor.
- Un servidor pequeño como punto único de integración.
- Sheets/Drive aislados en adaptadores.
- Versionado de contenido antes de introducir colaboración o tiempo real.
- Sin microservicios ni eventos distribuidos hasta que exista una necesidad operativa comprobable.