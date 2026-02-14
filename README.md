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

- **Dashboard**: Total de registros cargados, memoria, uptime y registros por tipo de padron
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

### Estado de carga

```
GET /api/v1/upload/status/:jobId
```

### Health check

```
GET /api/v1/health
```

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

Archivo de texto plano separado por punto y coma (`;`):

```
fechaPublicacion;fechaDesde;fechaHasta;cuit;tipoContribuyente;marcaAlta;marcaBaja;alicuotaPercepcion;alicuotaRetencion;grupoPercepcion;grupoRetencion;
```

Ejemplo:
```
27082025;01092025;30092025;20000000028;D;N;N;6,00;5,00;25;24;
```

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
