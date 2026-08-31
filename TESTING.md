# Tests

Suite de pruebas unitarias y de integración de Wrapper CRM, con ejecución automática en
cada pull request.

| | Tests | Cobertura de líneas | Cobertura de ramas |
| --- | ---: | ---: | ---: |
| `frontend/src/lib` (parser, métricas, IA, API) | — | 98.3% | 91.6% |
| `frontend` (global) | 651 | 51.4% | 42.8% |
| `backend/Services` | — | 96.5% | 88.3% |
| `backend/Endpoints` | — | 88.7% | 89.7% |
| `backend` (global) | 564 | 91.4% | 83.7% |

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
de GitHub (UTC). Esa decisión es lo que hizo visible el hallazgo 4 de más abajo.

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

# Hallazgos resueltos

Los cinco desfasajes que la suite destapó entre lo que el código hacía y lo que la
especificación de `Project_Context/` describe. Se documentaron primero y se arreglaron
después, en ramas separadas, para que el diff de "agregar cobertura" no se mezclara con el
de "cambiar comportamiento".

Cada uno tiene hoy un test normal que lo cubre. Mientras estuvieron abiertos se
documentaron con `it.fails` (frontend) y `[Fact(Skip)]` (backend); **que la suite hoy
reporte cero `expected fail` y cero `skipped` es la señal de que ninguno quedó a medias.**

## 1. Los exports de iOS con corchetes no se parseaban · alto

`frontend/src/lib/parser.ts` — `messageStartPattern`

El patrón exigía un guion después de la hora. WhatsApp en iOS exporta sin él:

```
[13/03/2025, 21:15:00] Ana: hola          ← no matcheaba
[13/03/2025, 21:15:00] - Ana: hola        ← sí matcheaba
```

Un export así producía cero mensajes y el usuario veía la pantalla de "no se encontró
contenido". `Project_Context/03_Procesamiento_Datos_y_Regex.md` §1 nombra la variante con
corchetes explícitamente.

**Arreglo:** el guion pasó a ser opcional, pero **sólo detrás del `]`**. En la forma sin
corchetes sigue siendo obligatorio, que es lo que evita que una línea suelta con fecha y
hora parta un mensaje al medio.

## 2. Los exports en inglés con hora de 12 horas no se parseaban · alto

`frontend/src/lib/parser.ts` — `messageStartPattern` y `to24Hour`

Después de la hora, el patrón esperaba espacios y un guion. El formato de 12 horas mete
`AM`/`PM` en el medio:

```
3/13/25, 9:15 PM - Ana: hola              ← no matcheaba
```

Es el formato estándar de los exports en inglés, y la app declara soporte de inglés.

**Arreglo:** un grupo `meridiem` opcional en el patrón, más una conversión a 24 horas en
`to24Hour`. Tres detalles que valen la pena:

- **El espacio angosto no necesitó un caso especial.** Las versiones nuevas ponen un U+202F
  antes del "PM", y el `\s` de JavaScript ya cubre toda la categoría Zs.
- **El grupo captura, pero eso no alcanzaba.** Había que agregar `meridiem` a `RawEntry` y
  pasarlo hasta `parseTimestamp`; sin ese plumbing, `9:15 PM` se guardaba como las 09:15
  sin ningún error visible — y el test que lo cubría, al ser `it.fails`, lo habría
  reportado en verde. Por eso convertir esos tests fue parte del mismo cambio, no un paso
  posterior.
- **Hay un guard para `hours > 12`.** Ante un dato malformado ("21:15 PM", que aparece en
  exports de apps de terceros), sumar 12 daría hora 33 y `new Date` no falla: rueda al día
  siguiente en silencio.

## 3. La variante sin coma entre fecha y hora no se parseaba · medio

`frontend/src/lib/parser.ts` — `messageStartPattern`

El grupo `(?:,\s*)?` sólo consumía el espacio si venía precedido de la coma:

```
20/1/2026 15:30 - Juan: Hola              ← no matcheaba
```

Es, textualmente, el ejemplo que da la spec en §1.

**Arreglo:** `,?\s*`, que acepta las dos formas.

**Costo aceptado:** un chat reenviado y pegado dentro de otro mensaje ahora arranca un
mensaje nuevo si trae fecha, hora y guion. No hay forma de soportar el formato sin coma sin
esto. Está cubierto por un test explícito para que nadie lo "arregle" sin advertir qué
rompe.

## 4. Las fechas de "día más activo" mostraban el día anterior · alto

`frontend/src/lib/metrics.ts` — `formatDate`

`formatDate` recibe dos clases de valor: timestamps ISO completos y claves de día del
estilo `"2025-03-10"`. `new Date("2025-03-10")` se interpreta como **medianoche UTC**, y
formateada en cualquier zona al oeste de Greenwich —toda América, o sea el público del
producto— retrocede un día. Sobre un 1 de enero se llevaba puesto **también el año**:
`2025-01-01` se mostraba como *31 de dic de 2024*.

Alcanzaba a siete lugares, todos los que pasan una clave de día: El Pulso del Chat, El Mes
Más Intenso (dos veces), El Fan de la Multimedia, El Arrepentido, Días de Racha y el eje
de la onda de actividad en granularidad diaria. Las fechas que salen de un timestamp
completo (El Rompehielo, El Dramático, El Tono Picante) siempre estuvieron bien.

**Arreglo:** un helper `toLocalDate` que ancla la clave de día a medianoche **local** —
el mismo recurso que ya usaban `weekKey` y `formatWeekLabel`. Un solo punto cubre los
siete sitios.

**No se tocaron** `getDailyStreaks` ni `makeStreak`: comparan dos claves entre sí, nunca
contra un reloj de pared, así que UTC-contra-UTC da un resultado exacto e inmune al horario
de verano. Sólo el formateo estaba mal.

## 5. El plan sin prueba gratis mandaba `free_trial: null` · medio

`backend/Services/MercadoPagoClient.cs` — `CreatePlanAsync`

El serializador está configurado con `DefaultIgnoreCondition = WhenWritingNull`, pero esa
opción **no se aplica a los valores de un `Dictionary<string, object?>`** — sólo a
propiedades de un POCO. El cuerpo que se mandaba a `/preapproval_plan` quedaba así:

```json
{"auto_recurring":{ … ,"free_trial":null}, …}
```

Es la misma clase de envío que `GoogleAiClient` documenta como rechazada por su API
(*"An explicit `thinkingConfig: null` is rejected by the API, so omit instead"*). Afectaba
sólo a la creación automática del plan sin trial, o sea a las cuentas que ya usaron su
semana gratis.

**Arreglo:** la clave se agrega sólo cuando corresponde, en vez de ponerse en null. Y
`JsonOptions` lleva una nota que explica el alcance real de `WhenWritingNull`, para que el
próximo cuerpo no vuelva a confiar en algo que no aplica.

## 6. Las fechas ambiguas se leían como MDY · medio

`frontend/src/lib/parser.ts` — `inferDateOrder`

`inferDateOrder` vota mirando las primeras 50 líneas: si ninguna tenía un día mayor a 12,
caía en `MDY`. Para un export argentino donde todos los mensajes cayeron entre el 1 y el 12
del mes, un `03/04/2025` se leía como 4 de marzo en vez de 3 de abril.

**Arreglo:** soportar AM/PM (hallazgo 2) trajo una señal nueva y confiable para desempatar.
Un export con reloj de 12 horas viene casi siempre de un teléfono en inglés, que escribe
mes/día; cualquier otro idioma en el que WhatsApp exporta usa 24 horas y día/mes. Así que
ante un empate: con AM/PM → `MDY`, sin AM/PM → `DMY`.

---

## Fuera de alcance

Formatos de export que la suite evaluó y que **se decidió no soportar**. Van como texto y
no como `it.fails` justamente porque no son bugs pendientes sino decisiones:

- **Fecha con puntos** — `13.03.2025, 21:15 - Ana: hola` (locales de/ru/pl/fi). Exigiría
  cambiar también los `split(/[/-]/)` de `inferDateOrder` y `parseTimestamp`, y el punto
  choca con el separador de miles del español: el corpus real tiene líneas como
  `"12.000 peajes"` y `"17.00 A 21.00- CANCHA ABIERTA"`.
- **Año primero** — `2025-03-13, 21:15 - Ana: hola` (locales zh/sv/hu/lt). El `\d{1,2}` del
  primer campo lo impide, y romperia `inferDateOrder`/`parseTimestamp`, que asumen
  `[a, b, año]`.

Ninguno de los dos aplica a `es` ni a `en`, que es el soporte que la app declara.

## Observaciones

**Cinco advertencias de lint preexistentes.** Cuatro de `react-hooks/exhaustive-deps` en
`useVistazo.ts` y una de `react/only-export-components` en `TooltipProvider.tsx`. Ninguna
la introdujeron los tests. El workflow usa `--max-warnings=5` para que no puedan aparecer
más; bajarlo a `0` es el paso siguiente cuando se limpien.

**Un checkout sin credenciales devuelve 502 aunque la cuenta ya tenga Pro.** El chequeo
"el proveedor está configurado" viene antes que "ya tenés una suscripción", así que un
despliegue sin Mercado Pago nunca llega a contestar `already_active`. No es incorrecto,
pero conviene saberlo al leer los logs. Documentado en `SubscriptionEndpointTests` →
`Sin_proveedor_configurado_el_502_gana_incluso_con_suscripcion_vigente`.

**El parser corre sobre cada línea en el hilo principal.** `messageStartPattern` tiene un
guard de performance en `parser.test.ts`: una versión intermedia del patrón, con dos `\s*`
adyacentes alrededor del grupo del meridiano, era cuadrática y tardaba 526 ms en una línea
de 16.000 espacios. El test existe para que un refactor futuro no lo reintroduzca.
