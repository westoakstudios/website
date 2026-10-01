
import { startTcpServer } from './src/tcp.js';
import { startHttpServer } from './src/http.js';
import { startSweep } from './src/state.js';

startTcpServer();
startHttpServer();
startSweep();

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));