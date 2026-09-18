# Middleware Padron

Middleware para consulta de padrones fiscales argentinos (ARBA, AGIP, IIBB) desde NetSuite.

## Servidor

- **URL**: `http://TU-IP-SERVIDOR:3000`
- **Autenticacion**: Header `x-api-key`
- **Panel web**: `http://TU-IP-SERVIDOR:3000/panel`

---

## Panel Web

Interfaz visual para administrar los padrones sin necesidad de Postman ni terminal.

**Acceso**: `http://TU-IP-SERVIDOR:3000/panel`

Al ingresar te pide la API key. Una vez dentro tenes:

- **Dashboard**: Total de registros cargados, memoria, uptime, registros por tipo de padron y
  periodos cargados (tipo, regimen, desde, hasta). Los totales se calculan en segundo plano al
  arrancar y al terminar cada carga; hasta entonces el panel muestra "calculando…"
- **Subir Padron**: Selecciona el tipo (ARBA, AGIP, etc.), arrastra el archivo o hace click para seleccionarlo. Muestra barra de progreso durante la carga
- **Consultar CUIT**: Ingresa un CUIT y una fecha para ver las alicuotas vigentes
- **Historial de cargas**: Todas las cargas anteriores con fecha, cantidad de registros y estado

### Como subir un padron desde el panel

1. Abri `http://TU-IP-SERVIDOR:3000/panel`
2. Ingresa tu API key
3. En **Subir Padron** selecciona el tipo (ej: ARBA)
4. Arrastra el archivo .txt o hace click para seleccionarlo
5. Click en **Subir Padron**
6. Espera a que la barra de progreso llegue al 100%
7. La pagina se recarga automaticamente mostrando los nuevos datos

### Como consultar un CUIT desde el panel

1. En la seccion **Consultar CUIT** escribi el CUIT (con o sin guiones)
2. Selecciona la fecha de referencia
3. Click en **Buscar**
4. Se muestra el resultado con las alicuotas de percepcion y retencion

---

## Endpoints disponibles

### Consultar por CUIT

```
GET /api/v1/padron/:cuit?fecha=YYYY-MM-DD&tipo=ARBA
```

| Parametro | Tipo | Requerido | Descripcion |
|-----------|------|-----------|-------------|
| `:cuit` | path | Si | CUIT a consultar (11 digitos, con o sin guiones) |
| `fecha` | query | No | Fecha de referencia (default: hoy) |
| `tipo` | query | No | Tipo de padron: ARBA, AGIP, IIBB_CABA, etc. |

### Consultar por CUIT con rango de fechas

```
GET /api/v1/padron/:cuit/rango?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&tipo=ARBA
```

| Parametro | Tipo | Requerido | Descripcion |
|-----------|------|-----------|-------------|
| `:cuit` | path | Si | CUIT a consultar |
| `desde` | query | Si | Fecha inicio del rango |
| `hasta` | query | Si | Fecha fin del rango |
| `tipo` | query | No | Tipo de padron |

### Consulta batch (multiples CUITs)

```
POST /api/v1/padron/batch
Content-Type: application/json

{
  "cuits": ["20000000028", "30500001234"],
  "fecha": "2025-09-15",
  "tipo": "ARBA"
}
```

Maximo 500 CUITs por consulta.

### Subir archivo de padron

```
POST /api/v1/upload/:padronType
Content-Type: multipart/form-data
Campo: padronFile
```

- Por defecto **acumula** datos historicos
- Si subis el mismo archivo dos veces, no se duplican los datos
- Usar `?replace=true` para borrar todos los datos anteriores de ese tipo
- Antes de cargar se valida la estructura del archivo y que su layout sea uno de los
  admitidos para ese tipo (ver [Que layout admite cada tipo](#que-layout-admite-cada-tipo-de-padron)).
  Subir el unificado de AGIP como `ARBA`, o un padron con prefijo `P`/`R` como `AGIP`, responde
  `400 LAYOUT_MISMATCH` y no toca la base.
  `reload` aplica las mismas validaciones.
- La carga corre en un **worker thread** con su propia conexion a SQLite, asi que las consultas
  por CUIT siguen respondiendo mientras se borra e inserta. Las cargas se ejecutan **de a una**:
  si llega otra mientras hay una en curso, queda en cola (`status: "queued"`).
- Ademas de la cola en memoria, cada carga toma un **candado en la base** (tabla `load_lock`)
  antes de borrar o insertar, y lo libera al terminar, incluso con error. Asi dos cargas nunca
  corren a la vez aunque haya varias instancias de PM2 o mas de un proceso: la segunda espera
  (`status: "queued"`, con `waitingFor` indicando el job que tiene el candado). Sin esto, dos
  cargas del mismo periodo en paralelo dejaban filas duplicadas: la purga de la segunda solo
  borraba lo que la primera ya habia insertado. Cada lote de borrado o insercion comprueba,
  dentro de su propia transaccion, que el candado sigue siendo suyo: una carga que lo perdio
  falla ahi mismo sin escribir una fila mas. Un candado cuyo proceso murio sin liberarlo se
  considera vencido (proceso inexistente en el mismo host, o 30 minutos sin latir) y la
  siguiente carga lo toma. Si hiciera falta liberarlo a mano: `DELETE FROM load_lock`.
- Los borrados (del tipo entero con `replace=true`, o del periodo repetido en modo acumular) se
  hacen en lotes de 50.000 filas para que el WAL no crezca al tamaño del periodo.

### Estado de carga

```
GET /api/v1/upload/status/:jobId
```

```json
{
  "jobId": "load-arba-1789147939750",
  "padronType": "ARBA",
  "filename": "PADRON_UNIFICADO_ARBA.txt",
  "status": "loading",
  "recordsDeleted": 832379,
  "recordsLoaded": 700000,
  "queuedAt": "2026-09-11T17:32:19.750Z",
  "startedAt": "2026-09-11T17:32:19.751Z",
  "completedAt": null,
  "error": null
}
```

`status` pasa por `queued` (esperando que termine otra carga, en este proceso o en otro),
`loading`, y termina en `completed` o `error`. Mientras espera el candado de otro proceso,
`waitingFor` trae `{ jobId, padronType, host, pid }` de la carga que lo tiene; el resto del
tiempo es `null`. `recordsDeleted` cuenta las filas anteriores borradas antes de insertar.
Los jobs viven en memoria: tras un reinicio del servidor responden `404 JOB_NOT_FOUND`.

### Health check

```
GET /api/v1/health
```

`totalRecords` y `padronesLoaded` salen de una cache de estadisticas que se recalcula en un
worker al arrancar y al terminar cada carga (contar la tabla en cada pedido bloqueaba el servidor
con millones de filas). `stats.status` es `pendiente` hasta el primer calculo, con
`totalRecords: null`, y despues `ok` con `stats.computedAt`. `GET /api/v1/padron-info` usa la
misma cache y agrega, por tipo, la lista de `periodos` cargados (regimen, desde, hasta, registros).

---

## Respuesta del API

Todas las respuestas tienen este formato:

```json
{
  "success": true,
  "data": {
    "cuit": "20000000028",
    "records": [
      {
        "padronType": "ARBA",
        "regimen": "AMBOS",
        "fechaPublicacion": "2025-08-27",
        "fechaDesde": "2025-09-01",
        "fechaHasta": "2025-09-30",
        "tipoContribuyente": "D",
        "marcaAlta": "N",
        "marcaBaja": "N",
        "alicuotaPercepcion": 6.00,
        "alicuotaRetencion": 5.00,
        "grupoPercepcion": 25,
        "grupoRetencion": 24
      }
    ],
    "count": 1
  },
  "error": null
}
```

El campo `regimen` indica que alicuotas trae ese registro segun el archivo de origen:
`P` solo percepcion, `R` solo retencion, `AMBOS` las dos. Las alicuotas que el archivo
no informa vienen en `0` y sus grupos en `null`.

Cuando no se encuentra el CUIT:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "CUIT_NOT_FOUND",
    "message": "No se encontraron registros para CUIT 99999999999"
  }
}
```

---

## Integracion con NetSuite

### 1. Consulta simple por CUIT

Consulta la alicuota de un vendor/customer en una fecha determinada.

```javascript
/**
 * Consulta el padron para un CUIT en una fecha especifica.
 *
 * @param {string} cuit - CUIT del contribuyente (11 digitos)
 * @param {string} fecha - Fecha en formato YYYY-MM-DD
 * @param {string} [tipo] - Tipo de padron: 'ARBA', 'AGIP', etc.
 * @returns {Object|null} Registro del padron o null si no existe
 */
function consultarPadron(cuit, fecha, tipo) {
    var url = 'http://TU-IP-SERVIDOR:3000/api/v1/padron/' + cuit;
    url += '?fecha=' + fecha;
    if (tipo) {
        url += '&tipo=' + tipo;
    }

    var response = https.get({
        url: url,
        headers: {
            'x-api-key': 'TU-API-KEY'
        }
    });

    var body = JSON.parse(response.body);

    if (!body.success || body.data.count === 0) {
        return null;
    }

    return body.data.records[0];
}

// Ejemplo de uso:
var resultado = consultarPadron('20123456789', '2025-09-15', 'ARBA');
if (resultado) {
    log.debug('Alicuota Percepcion: ' + resultado.alicuotaPercepcion);
    log.debug('Alicuota Retencion: ' + resultado.alicuotaRetencion);
    log.debug('Grupo Percepcion: ' + resultado.grupoPercepcion);
    log.debug('Grupo Retencion: ' + resultado.grupoRetencion);
} else {
    log.debug('CUIT no encontrado en padron');
}
```

### 2. Consulta en User Event (antes de guardar transaccion)

Busca automaticamente la alicuota cuando se crea o edita una factura.

```javascript
/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/https', 'N/record', 'N/log'], function(https, record, log) {

    const API_URL = 'http://TU-IP-SERVIDOR:3000/api/v1/padron/';
    const API_KEY = 'TU-API-KEY';

    function beforeSubmit(context) {
        if (context.type !== context.UserEventType.CREATE &&
            context.type !== context.UserEventType.EDIT) {
            return;
        }

        var rec = context.newRecord;

        // Obtener CUIT del vendor/customer
        // Ajustar el field ID segun tu cuenta de NetSuite
        var cuit = rec.getValue({ fieldId: 'custbody_cuit_entidad' });
        if (!cuit) return;

        // Obtener fecha de la transaccion
        var tranDate = rec.getValue({ fieldId: 'trandate' });
        var fecha = formatDate(tranDate);

        // Consultar padron
        try {
            var response = https.get({
                url: API_URL + cuit + '?fecha=' + fecha + '&tipo=ARBA',
                headers: { 'x-api-key': API_KEY }
            });

            var body = JSON.parse(response.body);

            if (body.success && body.data.count > 0) {
                var padron = body.data.records[0];

                // Setear alicuotas en campos custom de la transaccion
                // Ajustar los field IDs segun tu cuenta
                rec.setValue({
                    fieldId: 'custbody_alicuota_percepcion',
                    value: padron.alicuotaPercepcion
                });
                rec.setValue({
                    fieldId: 'custbody_alicuota_retencion',
                    value: padron.alicuotaRetencion
                });
                rec.setValue({
                    fieldId: 'custbody_grupo_percepcion',
                    value: padron.grupoPercepcion
                });
                rec.setValue({
                    fieldId: 'custbody_grupo_retencion',
                    value: padron.grupoRetencion
                });

                log.debug('Padron', 'CUIT ' + cuit + ' - Percepcion: ' +
                    padron.alicuotaPercepcion + '% - Retencion: ' +
                    padron.alicuotaRetencion + '%');
            } else {
                log.debug('Padron', 'CUIT ' + cuit + ' no encontrado en padron');
            }
        } catch (e) {
            log.error('Error consultando padron', e.message);
        }
    }

    function formatDate(dateObj) {
        var year = dateObj.getFullYear();
        var month = String(dateObj.getMonth() + 1).padStart(2, '0');
        var day = String(dateObj.getDate()).padStart(2, '0');
        return year + '-' + month + '-' + day;
    }

    return {
        beforeSubmit: beforeSubmit
    };
});
```

### 3. Consulta batch en Map/Reduce

Para procesar muchos vendors/customers de una vez.

```javascript
/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/https', 'N/search', 'N/record', 'N/log'], function(https, search, record, log) {

    const API_URL = 'http://TU-IP-SERVIDOR:3000/api/v1/padron/batch';
    const API_KEY = 'TU-API-KEY';

    function getInputData() {
        // Buscar vendors que necesitan actualizacion de alicuotas
        return search.create({
            type: search.Type.VENDOR,
            filters: [
                ['custentity_cuit', 'isnotempty', '']
            ],
            columns: [
                'entityid',
                'custentity_cuit'
            ]
        });
    }

    function map(context) {
        var result = JSON.parse(context.value);
        var cuit = result.values.custentity_cuit;
        var vendorId = result.id;

        // Agrupar por lotes de CUITs
        // Usar un key fijo para agrupar todos en el reduce
        context.write({
            key: 'batch',
            value: JSON.stringify({ vendorId: vendorId, cuit: cuit })
        });
    }

    function reduce(context) {
        var vendors = context.values.map(function(v) { return JSON.parse(v); });

        // Procesar en lotes de 500
        for (var i = 0; i < vendors.length; i += 500) {
            var batch = vendors.slice(i, i + 500);
            var cuits = batch.map(function(v) { return v.cuit; });

            var today = new Date().toISOString().split('T')[0];

            var response = https.post({
                url: API_URL,
                headers: {
                    'x-api-key': API_KEY,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    cuits: cuits,
                    fecha: today,
                    tipo: 'ARBA'
                })
            });

            var body = JSON.parse(response.body);

            if (!body.success) {
                log.error('Error en batch', body.error.message);
                continue;
            }

            // Actualizar cada vendor con su alicuota
            batch.forEach(function(vendor) {
                var padronData = body.data.results[vendor.cuit];
                if (padronData && padronData.found && padronData.records.length > 0) {
                    var padron = padronData.records[0];
                    try {
                        record.submitFields({
                            type: record.Type.VENDOR,
                            id: vendor.vendorId,
                            values: {
                                'custentity_alicuota_percepcion': padron.alicuotaPercepcion,
                                'custentity_alicuota_retencion': padron.alicuotaRetencion
                            }
                        });
                        log.debug('Actualizado', 'Vendor ' + vendor.vendorId +
                            ' - CUIT ' + vendor.cuit +
                            ' - Percepcion: ' + padron.alicuotaPercepcion + '%');
                    } catch (e) {
                        log.error('Error actualizando vendor ' + vendor.vendorId, e.message);
                    }
                }
            });
        }
    }

    function summarize(summary) {
        log.audit('Resumen', 'Proceso completado. Errores: ' + summary.inputSummary.error);
    }

    return {
        getInputData: getInputData,
        map: map,
        reduce: reduce,
        summarize: summarize
    };
});
```

### 4. Consulta desde Suitelet (interfaz web)

Para que los usuarios puedan consultar manualmente desde NetSuite.

```javascript
/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/https', 'N/ui/serverWidget', 'N/log'], function(https, serverWidget, log) {

    const API_URL = 'http://TU-IP-SERVIDOR:3000/api/v1/padron/';
    const API_KEY = 'TU-API-KEY';

    function onRequest(context) {
        if (context.request.method === 'GET') {
            // Mostrar formulario
            var form = serverWidget.createForm({ title: 'Consulta de Padron' });

            form.addField({
                id: 'custpage_cuit',
                type: serverWidget.FieldType.TEXT,
                label: 'CUIT'
            });

            form.addField({
                id: 'custpage_fecha',
                type: serverWidget.FieldType.DATE,
                label: 'Fecha'
            });

            form.addField({
                id: 'custpage_tipo',
                type: serverWidget.FieldType.SELECT,
                label: 'Tipo de Padron',
                source: null
            }).addSelectOption({ value: '', text: '-- Todos --' })
              .addSelectOption({ value: 'ARBA', text: 'ARBA' })
              .addSelectOption({ value: 'AGIP', text: 'AGIP' })
              .addSelectOption({ value: 'IIBB_CABA', text: 'IIBB CABA' });

            // Si viene con parametros, mostrar resultado
            var cuit = context.request.parameters.custpage_cuit;
            if (cuit) {
                var fecha = context.request.parameters.custpage_fecha;
                var tipo = context.request.parameters.custpage_tipo;

                var url = API_URL + cuit;
                var params = [];
                if (fecha) params.push('fecha=' + fecha);
                if (tipo) params.push('tipo=' + tipo);
                if (params.length > 0) url += '?' + params.join('&');

                try {
                    var response = https.get({
                        url: url,
                        headers: { 'x-api-key': API_KEY }
                    });

                    var body = JSON.parse(response.body);

                    var resultField = form.addField({
                        id: 'custpage_resultado',
                        type: serverWidget.FieldType.LONGTEXT,
                        label: 'Resultado'
                    });
                    resultField.defaultValue = JSON.stringify(body, null, 2);
                } catch (e) {
                    log.error('Error', e.message);
                }
            }

            form.addSubmitButton({ label: 'Consultar' });
            context.response.writePage(form);
        } else {
            // Redirigir con parametros
            var params = {
                custpage_cuit: context.request.parameters.custpage_cuit,
                custpage_fecha: context.request.parameters.custpage_fecha,
                custpage_tipo: context.request.parameters.custpage_tipo
            };
            var qs = Object.keys(params)
                .filter(function(k) { return params[k]; })
                .map(function(k) { return k + '=' + encodeURIComponent(params[k]); })
                .join('&');

            context.response.sendRedirect({
                type: https.RedirectType.SUITELET,
                identifier: runtime.getCurrentScript().id,
                deploymentId: runtime.getCurrentScript().deploymentId,
                parameters: params
            });
        }
    }

    return { onRequest: onRequest };
});
```

### 5. Funcion utilitaria reutilizable

Crea un modulo utilitario para reutilizar en cualquier script.

```javascript
/**
 * @NApiVersion 2.1
 * @NModuleType SuiteScriptModule
 *
 * Modulo utilitario para consultar el middleware de padrones.
 * Uso: var padron = require('./SDB-Padron-Utils');
 *      var resultado = padron.consultar('20123456789', '2025-09-15', 'ARBA');
 */
define(['N/https', 'N/log'], function(https, log) {

    const API_BASE = 'http://TU-IP-SERVIDOR:3000/api/v1';
    const API_KEY = 'TU-API-KEY';

    function _request(method, path, body) {
        var options = {
            url: API_BASE + path,
            headers: {
                'x-api-key': API_KEY,
                'Content-Type': 'application/json'
            }
        };

        var response;
        if (method === 'GET') {
            response = https.get(options);
        } else {
            options.body = JSON.stringify(body);
            response = https.post(options);
        }

        return JSON.parse(response.body);
    }

    /**
     * Consulta un CUIT en el padron.
     * @param {string} cuit - CUIT (11 digitos)
     * @param {string} [fecha] - Fecha YYYY-MM-DD (default: hoy)
     * @param {string} [tipo] - Tipo: ARBA, AGIP, etc.
     * @returns {Object|null} Primer registro encontrado o null
     */
    function consultar(cuit, fecha, tipo) {
        var path = '/padron/' + cuit;
        var params = [];
        if (fecha) params.push('fecha=' + fecha);
        if (tipo) params.push('tipo=' + tipo);
        if (params.length > 0) path += '?' + params.join('&');

        try {
            var body = _request('GET', path);
            if (body.success && body.data.count > 0) {
                return body.data.records[0];
            }
            return null;
        } catch (e) {
            log.error('Padron - Error en consulta', e.message);
            return null;
        }
    }

    /**
     * Consulta multiples CUITs de una vez.
     * @param {string[]} cuits - Array de CUITs
     * @param {string} [fecha] - Fecha YYYY-MM-DD
     * @param {string} [tipo] - Tipo de padron
     * @returns {Object} Mapa de CUIT -> { found, records }
     */
    function consultarBatch(cuits, fecha, tipo) {
        try {
            var body = _request('POST', '/padron/batch', {
                cuits: cuits,
                fecha: fecha || new Date().toISOString().split('T')[0],
                tipo: tipo || undefined
            });
            if (body.success) {
                return body.data.results;
            }
            return {};
        } catch (e) {
            log.error('Padron - Error en batch', e.message);
            return {};
        }
    }

    /**
     * Consulta historial de un CUIT en un rango de fechas.
     * @param {string} cuit
     * @param {string} desde - YYYY-MM-DD
     * @param {string} hasta - YYYY-MM-DD
     * @param {string} [tipo]
     * @returns {Object[]} Array de registros
     */
    function consultarRango(cuit, desde, hasta, tipo) {
        var path = '/padron/' + cuit + '/rango?desde=' + desde + '&hasta=' + hasta;
        if (tipo) path += '&tipo=' + tipo;

        try {
            var body = _request('GET', path);
            if (body.success) {
                return body.data.records;
            }
            return [];
        } catch (e) {
            log.error('Padron - Error en rango', e.message);
            return [];
        }
    }

    return {
        consultar: consultar,
        consultarBatch: consultarBatch,
        consultarRango: consultarRango
    };
});
```

**Uso del modulo utilitario en cualquier script:**

```javascript
/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/log', './SDB-Padron-Utils'], function(log, padron) {

    function beforeSubmit(context) {
        var cuit = context.newRecord.getValue({ fieldId: 'custbody_cuit' });
        var fecha = context.newRecord.getValue({ fieldId: 'trandate' });

        var resultado = padron.consultar(cuit, fecha, 'ARBA');

        if (resultado) {
            log.debug('Alicuota', resultado.alicuotaPercepcion + '%');
        }
    }

    return { beforeSubmit: beforeSubmit };
});
```

---

## Subir padrones nuevos

Desde **Postman**:

1. `POST http://TU-IP-SERVIDOR:3000/api/v1/upload/ARBA`
2. Header: `x-api-key: TU-API-KEY`
3. Body: form-data, campo `padronFile` (tipo File), seleccionar el .txt

Los datos se acumulan. Si subis el mismo archivo dos veces no se duplican.

Para **reemplazar** todos los datos de un tipo: agregar `?replace=true` a la URL.

### Tipos de padron soportados

- `ARBA`
- `AGIP`
- `IIBB_CABA`
- `IIBB_SANTA_FE`
- `IIBB_CORDOBA`

---

## Formato del archivo de padron

Archivos de texto plano separados por punto y coma (`;`). El formato se **detecta solo**
a partir del primer campo de la primera linea util, no hace falta declararlo al subir.

| Primer campo | Layout | Regimen |
|--------------|--------|---------|
| 8 digitos (DDMMYYYY) | `UNIFICADO` (11/12 campos, el que publican ARBA y AGIP) | `AMBOS` |
| `P` | `PERCEPCION` | `P` |
| `R` | `RETENCION` | `R` |

Si la primera linea no coincide con ninguno de los tres, se asume que es un header y se saltea.

### Layout `UNIFICADO` (11 campos, sin prefijo)

```
fechaPublicacion;fechaDesde;fechaHasta;cuit;tipoContribuyente;marcaAlta;marcaBaja;alicuotaPercepcion;alicuotaRetencion;grupoPercepcion;grupoRetencion;[denominacion]
27082025;01092025;30092025;20000000028;D;N;N;6,00;5,00;25;24;
```

Minimo 11 campos. El campo 12 (denominacion / razon social) es opcional y se ignora.
ARBA lo publica con el campo 12 vacio y con codigos de grupo; AGIP (archivo "RET y PER")
lo publica con la denominacion cargada y ambos grupos en `00`.

| Campo | Descripcion | Ejemplo |
|-------|-------------|---------|
| fechaPublicacion | Fecha de publicacion (DDMMYYYY) | 27082025 |
| fechaDesde | Vigencia desde (DDMMYYYY) | 01092025 |
| fechaHasta | Vigencia hasta (DDMMYYYY) | 30092025 |
| cuit | CUIT del contribuyente (11 digitos) | 20000000028 |
| tipoContribuyente | Tipo: D, C, I, M | D |
| marcaAlta | Marca de alta: S/N | N |
| marcaBaja | Marca de baja: S/N | N |
| alicuotaPercepcion | Alicuota de percepcion (coma decimal) | 6,00 |
| alicuotaRetencion | Alicuota de retencion (coma decimal) | 5,00 |
| grupoPercepcion | Codigo grupo de percepcion | 25 |
| grupoRetencion | Codigo grupo de retencion | 24 |

### Layout `PERCEPCION` (prefijo `P`)

```
P;fechaPublicacion;fechaDesde;fechaHasta;cuit;tipoContribuyente;marcaAlta;marcaBaja;alicuotaPercepcion
P;22062026;01072026;31072026;20001220986;L;X;N;04,00
```

9 campos. No trae codigos de grupo ni alicuota de retencion: se guardan en `null` y `0`.

### Layout `RETENCION` (prefijo `R`)

```
R;fechaPublicacion;fechaDesde;fechaHasta;cuit;tipoContribuyente;marcaAlta;marcaBaja;alicuotaRetencion;grupoRetencion
R;25062026;01072026;31072026;20000282465;D;N;N;3,00;21;
```

10 campos minimo. No trae alicuota ni grupo de percepcion.

### Convivencia de percepcion y retencion

Un mismo `padronType` puede tener cargados el padron de percepcion y el de retencion
de la misma jurisdiccion y el mismo periodo. Cada registro guarda su `regimen`, y la
deduplicacion al reprocesar un archivo **borra solo el regimen que se esta cargando**:
subir el padron de retencion no pisa el de percepcion.

Consultar un CUIT en ese caso devuelve **dos registros** para el mismo periodo, uno por
regimen. Hay que mirar el campo `regimen` para saber cual usar.

> `?replace=true` es la excepcion: borra **todos** los datos de ese `padronType` sin
> importar el regimen. Si tenes percepcion y retencion bajo un mismo tipo, un replace
> se lleva ambos.

### Que layout admite cada tipo de padron

El archivo no trae ningun campo que identifique la jurisdiccion, y los mismos CUITs
aparecen en ARBA y en AGIP, asi que no hay forma de detectarla por contenido. Lo unico
que se puede chequear es el layout. Por eso cada `padronType` declara que layouts
admite, y un upload o reload cuyo layout no coincide se rechaza con `400 LAYOUT_MISMATCH`
**antes** de borrar o insertar nada, incluso con `?replace=true`.

ARBA se carga con sus padrones de regimenes generales, que vienen con prefijo `P` (percepcion)
y `R` (retencion, por ejemplo `PadronRGSRet092026.TXT`). AGIP publica el unificado de 12 campos
(`ARDJU008MMYYYY.TXT`). Como los layouts difieren, la politica frena el archivo de AGIP subido
como `ARBA` (el error mas comun: el panel arranca con `ARBA` seleccionado) y el de ARBA subido
como `AGIP`. Lo que no puede distinguir es un `P`/`R` de ARBA de uno de otra jurisdiccion, por
ejemplo el de Cordoba. El unificado de ARBA (`PADRON_UNIFICADO_ARBA.txt`) queda rechazado con
este default; si hiciera falta cargarlo, sumar `UNIFICADO` a la entrada de `ARBA`.

Se configura en `.env`:

```
# TIPO:LAYOUT[,LAYOUT]|TIPO:LAYOUT
PADRON_LAYOUTS=ARBA:PERCEPCION,RETENCION|AGIP:UNIFICADO
```

Ese es el valor por defecto si la variable no existe. Reglas:

- Un tipo **sin entrada** (por ejemplo `IIBB_SANTA_FE`) acepta cualquier layout y deja un
  warning en el log. Cuando aparezca el primer archivo real de esa jurisdiccion, agregar
  su layout al parser si es un formato nuevo y sumar la entrada a `PADRON_LAYOUTS`.
- Los layouts posibles son los que conoce el parser: `UNIFICADO`, `PERCEPCION`, `RETENCION`.
- Si la variable menciona un tipo que no esta en `ALLOWED_PADRON_TYPES` o un layout
  inexistente, el servidor **no levanta** y el log dice cual es el problema.
- `PADRON_LAYOUTS=` (vacio explicito) desactiva la politica por completo.

---

## Setup local (desarrollo)

```bash
git clone https://github.com/berna-SDB/middleware-padron.git
cd middleware-padron
npm install
cp .env.example .env
# Editar .env con tu configuracion
npm run dev
```

Tests (usan una base SQLite temporal, no tocan `data/`):

```bash
npm test
```

## Setup servidor (produccion)

```bash
# Instalar Node.js 20 y PM2
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git
npm install -g pm2

# Clonar y configurar
cd /opt
git clone https://github.com/berna-SDB/middleware-padron.git
cd middleware-padron
npm install --production
mkdir -p data/padrones
cp .env.example .env
nano .env  # Cambiar API_KEY

# Iniciar
pm2 start server.js --name middleware-padron
pm2 save
pm2 startup
```

## Actualizar servidor

```bash
ssh root@TU-IP-SERVIDOR
cd /opt/middleware-padron
git pull
pm2 restart middleware-padron
```

Actualizar con `pm2 restart` (no `pm2 reload`) y sin cargas en curso: un `reload` deja conviviendo
por unos segundos la instancia vieja con la nueva, y una carga que siguiera corriendo en la vieja
no conoceria el candado de carga de la nueva.

Al arrancar se corren las migraciones del esquema antes de abrir el puerto. La primera vez que
levanta esta version sobre una base grande elimina dos indices redundantes (`idx_cuit` e
`idx_padron_type`), lo que puede demorar unos minutos con disco lento: durante ese lapso el
servidor no acepta conexiones. Despues el puerto abre y las estadisticas se calculan en segundo
plano (`stats.status: "pendiente"` en health, "calculando…" en el panel).

## Mantenimiento de la base

Como las cargas acumulan periodos, la base crece con cada mes cargado y las recargas se vuelven
mas lentas cuando deja de entrar en la RAM del servidor. Conviene revisar de vez en cuando los
periodos cargados (`GET /api/v1/padron-info` o la tarjeta **Periodos cargados** del panel) y
borrar los que ya no se consultan. Con el servidor detenido (`pm2 stop middleware-padron`):

```bash
cd /opt/middleware-padron
NODE_PATH=./node_modules node -e "
const db = require('better-sqlite3')('data/padron.db');
// Ejemplo: borrar un periodo puntual de un tipo y regimen
const r = db.prepare(\"DELETE FROM padron_entries WHERE padron_type = ? AND regimen = ? AND fecha_desde = ? AND fecha_hasta = ?\")
  .run('AGIP', 'AMBOS', '2025-09-01', '2025-09-30');
console.log('borradas', r.changes);
db.exec('VACUUM');  // compacta el archivo; necesita espacio libre igual al tamaño de la base
"
pm2 start middleware-padron
```
