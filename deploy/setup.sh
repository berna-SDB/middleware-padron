#!/bin/bash
# Script de instalación automática - MiddleWare Padrón
# Correr como root en el servidor: bash setup.sh

echo "=== Instalando Node.js 20 ==="
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

echo "=== Instalando PM2 ==="
npm install -g pm2

echo "=== Instalando Git ==="
apt-get install -y git

echo "=== Creando directorio del proyecto ==="
mkdir -p /opt/middleware-padron
cd /opt/middleware-padron

echo "=== Clonando proyecto ==="
# CAMBIAR esta URL por tu repositorio de GitHub
git clone https://github.com/TU-USUARIO/middleware-padron.git .

echo "=== Instalando dependencias ==="
npm install --production

echo "=== Creando carpetas de datos ==="
mkdir -p data/padrones

echo "=== Creando archivo .env ==="
cat > .env << 'EOF'
PORT=3000
API_KEY=CAMBIAR-POR-UNA-CLAVE-SEGURA
DB_PATH=./data/padron.db
UPLOAD_DIR=./data/padrones
MAX_BATCH_CUITS=100
LOG_LEVEL=info
NODE_ENV=production
ALLOWED_PADRON_TYPES=ARBA,AGIP,IIBB_CABA,IIBB_SANTA_FE,IIBB_CORDOBA
EOF

echo "=== Iniciando con PM2 ==="
pm2 start server.js --name middleware-padron
pm2 save
pm2 startup

echo ""
echo "========================================="
echo "  INSTALACION COMPLETADA"
echo "  Servidor corriendo en puerto 3000"
echo "  IMPORTANTE: Editá .env y cambiá API_KEY"
echo "========================================="
