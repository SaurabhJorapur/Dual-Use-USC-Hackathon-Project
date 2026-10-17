import Retell from 'retell-sdk';
import { config } from './config.js';

export const retell = config.retellApiKey ? new Retell({ apiKey: config.retellApiKey }) : null;
