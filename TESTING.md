# Tests

Suite de pruebas unitarias y de integración de Wrapper CRM, con ejecución automática en
cada pull request.

| | Tests | Cobertura de líneas | Cobertura de ramas |
| --- | ---: | ---: | ---: |
| `frontend/src/lib` (parser, métricas, IA, API) | — | 98.3% | 91.4% |
| `frontend` (global) | 627 | 51.1% | 42.4% |
| `backend/Services` | — | 96.4% | 88.3% |
| `backend/Endpoints` | — | 88.7% | 89.7% |
| `backend` (global) | 565 | 91.4% | 83.7% |

El global del frontend es bajo a propósito: el alcance acordado cubre la lógica y los
endpoints, no el renderizado de los ~40 componentes ni de los dos shells. Subir ese
número exigiría tests de UI decorativos que no atrapan nada.

## Cómo correrlos

```bash
cd frontend && npm test
```

```bash
dotnet test Wrapper.sln
```

Con cobertura:

```bash
cd frontend && npm run test:coverage
```

```bash
dotnet test Wrapper.sln --collect:"XPlat Code Coverage" --results-directory backend.Tests/TestResults
```

Y el resumen combinado con los umbrales, igual que en CI:

```bash
node scripts/coverage-gate.mjs
```

## Qué corre en cada PR

`.github/workflows/tests.yml` levanta tres jobs:

| Job | Qué hace | Rompe el PR si… |
| --- | --- | --- |
| **Frontend** | `oxlint --max-warnings=5`, `tsc -b && vite build`, `vitest run --coverage` | falla un test, no compila, o aparece una advertencia de lint nueva |
| **Backend** | `dotnet build -warnaserror`, `dotnet test --collect:"XPlat Code Coverage"` | falla un test o el compilador emite cualquier advertencia |
| **Cobertura** | junta los dos informes, escribe una tabla en el resumen del PR | una zona baja del umbral |

Los umbrales por zona viven en dos lugares: los del frontend en `frontend/vitest.config.ts`
(los hace cumplir vitest) y los del backend en `scripts/coverage-gate.mjs`. Todos están
unos puntos por debajo de lo medido: margen para un refactor honesto, freno para el
borrado de tests.

## Cómo está armado

### Frontend — Vitest + Testing Library

Los tests viven en `__tests__/` junto al código que prueban. `src/test/setup.ts` completa
lo que jsdom no trae (`matchMedia`, `IntersectionObserver`, `Blob.arrayBuffer`) y
`src/test/fixtures.ts` construye `ChatMessage` con los mismos campos derivados que
produce el parser real, para que un fixture mal armado no haga pasar un test por el
motivo equivocado.

`vitest.config.ts` fija `TZ=America/Argentina/Buenos_Aires` antes que nada. Media app
formatea fechas con `Intl` sobre horas locales y varias métricas cortan el día a las 6am:
sin fijar la zona, la misma aserción da distinto en una máquina argentina que en el runner
de GitHub (UTC).

### Backend — xUnit + WebApplicationFactory

Los tests de servicio construyen la clase real contra una SQLite **en memoria**
(`TestDb`), no contra el proveedor InMemory de EF: la app depende de índices únicos
—que son lo que hace idempotente gastar un desbloqueo y lo que evita que un webhook
reentregado duplique una factura— y de claves foráneas que InMemory no aplica. Un test
sobre InMemory pasaría verde justo donde la base de verdad falla.

Los tests de endpoint levantan la API entera con su pipeline real (`ApiFactory`):
autenticación JWT, rate limiting, serialización y las 22 rutas. Nada sale a la red:
`StubHttpMessageHandler` reemplaza a Gemini, Mercado Pago y reCAPTCHA, y la factory
arranca sin credenciales de terceros a propósito.

Dos cambios mínimos en el código de producción hicieron falta para esto, ninguno con
efecto en runtime: `backend/AssemblyInfo.cs` (un `InternalsVisibleTo` para el proyecto de
tests) y una declaración `public partial class Program;` al final de `Program.cs`.

---

# Hallazgos

Estos son los desfasajes que los tests destaparon entre lo que el código hace y lo que la
especificación de `Project_Context/` describe. **No se corrigió ninguno**: la rama es sólo
de tests.

Cada uno está cubierto por un test que documenta el comportamiento correcto. En el
frontend se usa `it.fails`, que ejecuta el caso y espera que falle — si alguien arregla el
bug, el test empieza a pasar y *eso* rompe la suite, que es lo que fuerza a convertirlo en
un `it` normal en vez de olvidarlo. En el backend el equivalente es un `[Fact(Skip = …)]`
que apunta acá.

## 1. Los exports de iOS con corchetes no se parsean · alto

`frontend/src/lib/parser.ts` — `messageStartPattern`

El patrón exige un guion después de la hora: `(?:\]\s*-\s*|\s*-\s*)`. WhatsApp en iOS
exporta sin ese guion:

```
[13/03/2025, 21:15:00] Ana: hola          ← no matchea
[13/03/2025, 21:15:00] - Ana: hola        ← sí matchea
```

Un export así produce cero mensajes y el usuario ve la pantalla de "no se encontró
contenido". `Project_Context/03_Procesamiento_Datos_y_Regex.md` §1 nombra la variante con
corchetes explícitamente y pide que el parser sea tolerante a ella.

Test: `parser.test.ts` → *"debería parsear el export de iOS con corchetes y sin guion"*.

## 2. Los exports en inglés con hora de 12 horas no se parsean · alto

`frontend/src/lib/parser.ts` — `messageStartPattern`

Después de la hora, el patrón espera espacios y un guion. El formato de 12 horas mete
`AM`/`PM` en el medio:

```
3/13/25, 9:15 PM - Ana: hola              ← no matchea
```

Es el formato estándar de los exports en inglés, y la app declara soporte de inglés
(`Language = 'es' | 'en'`). Vale para el espacio normal y para el espacio angosto
(U+202F) que usan las versiones recientes de la app.

Tests: `parser.test.ts` → *"debería parsear el export en inglés con hora de 12 horas
(AM/PM)"* y *"…separado por espacio angosto (U+202F)"*.

## 3. La variante sin coma entre fecha y hora no se parsea · medio

`frontend/src/lib/parser.ts` — `messageStartPattern`

El grupo `(?:,\s*)?` sólo consume el espacio si vino precedido de la coma, así que sin
coma la hora queda con un espacio adelante y no matchea:

```
20/1/2026 15:30 - Juan: Hola              ← no matchea
20/1/2026, 15:30 - Juan: Hola             ← sí matchea
```

Es, textualmente, el ejemplo que da la spec en
`Project_Context/03_Procesamiento_Datos_y_Regex.md` §1.

Test: `parser.test.ts` → *"debería parsear la variante sin coma entre fecha y hora"*.

## 4. Las fechas de "día más activo" muestran el día anterior · alto

`frontend/src/lib/metrics.ts` — `formatDate`

`formatDate` recibe dos clases de valor: timestamps ISO completos (correcto) y claves de
día del estilo `"2025-03-10"`. `new Date("2025-03-10")` se interpreta como **medianoche
UTC**, y formateada en cualquier zona al oeste de Greenwich —toda América, o sea el
público del producto— retrocede un día.

En una máquina en `America/Argentina/Buenos_Aires`, un chat cuyo día más activo es el 10
de marzo muestra **"09 de mar de 2025"**.

Alcanza a siete lugares, todos los que pasan una clave de día:

| Métrica | Dónde se ve |
| --- | --- |
| El Pulso del Chat | "mensajes en el día más activo (…)" |
| El Mes Más Intenso | "mensajes el (…)" y las etiquetas del ranking de 10 días |
| El Fan de la Multimedia | etiquetas de los 5 días con más envíos |
| El Arrepentido | etiquetas del timeline diario |
| Días de Racha | fechas de inicio y fin de cada racha |
| El Pulso del Chat | etiquetas del eje cuando la granularidad es diaria |
| El Mes Más Intenso | encabezado de cada fragmento de día pico |

Las fechas que salen de un timestamp completo (El Rompehielo, El Dramático, El Tono
Picante) están bien.

Tests: `metrics-free.test.ts` → *"la fecha del día más activo debería ser la del mensaje,
no la de ayer"* (y su par *"hoy el desplazamiento de un día es observable"*, que fija el
comportamiento actual para que el arreglo se note).

## 5. El plan sin prueba gratis manda `free_trial: null` en vez de omitirlo · medio

`backend/Services/MercadoPagoClient.cs` — `SendAsync`

El serializador está configurado con `DefaultIgnoreCondition = WhenWritingNull`, pero esa
opción **no se aplica a los valores de un `Dictionary<string, object?>`** — sólo a
propiedades de un POCO. El cuerpo que se manda a `/preapproval_plan` queda así:

```json
{"auto_recurring":{ … ,"free_trial":null}, …}
```

Es la misma clase de envío que `GoogleAiClient` documenta como rechazada por su API
(*"An explicit `thinkingConfig: null` is rejected by the API, so omit instead"*), y la
intención del código acá era claramente omitirlo. Afecta sólo a la creación automática del
plan sin trial, o sea a las cuentas que ya usaron su semana gratis.

Tests: `MercadoPagoClientTests` → `El_plan_sin_trial_DEBERIA_omitir_el_campo_free_trial`
(skipped) y `El_plan_sin_trial_manda_hoy_free_trial_en_null_documenta_el_bug`.

## Observaciones (no son bugs, son decisiones a confirmar)

**Las fechas ambiguas se leen como MDY.** `inferDateOrder` vota mirando las primeras 50
líneas: si ninguna tiene un día mayor a 12, cae en `MDY`. Para un export argentino donde
todos los mensajes cayeron entre el 1 y el 12 del mes, un `03/04/2025` se lee como 4 de
marzo en vez de 3 de abril. La spec no dice cuál debería ganar; dado el público, valdría
la pena que el default fuera DMY. Está documentado en
`parser.test.ts` → *"cae en MDY cuando el archivo es completamente ambiguo"*.

**Cinco advertencias de lint preexistentes.** Cuatro de `react-hooks/exhaustive-deps` en
`useVistazo.ts` y una de `react/only-export-components` en `TooltipProvider.tsx`. Ninguna
la introdujeron estos tests. El workflow usa `--max-warnings=5` para que no puedan
aparecer más; bajarlo a `0` es el paso siguiente cuando se limpien.

**Un checkout sin credenciales devuelve 502 aunque la cuenta ya tenga Pro.** El chequeo
"el proveedor está configurado" viene antes que "ya tenés una suscripción", así que un
despliegue sin Mercado Pago nunca llega a contestar `already_active`. No es incorrecto,
pero conviene saberlo al leer los logs. Documentado en `SubscriptionEndpointTests` →
`Sin_proveedor_configurado_el_502_gana_incluso_con_suscripcion_vigente`.
