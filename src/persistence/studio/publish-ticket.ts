import type { Document } from '../../domain/studio/model';
import { mintPublishTicket as mintTicket, validatePublishTicket as validateTicket } from '@canvas-one/history';
export type MintPublishTicketParams = import('@canvas-one/history').MintPublishTicketParams<Document>;
export type PublishTicket = import('@canvas-one/history').PublishTicket<Document>;
export type PublishTicketBinding = import('@canvas-one/history').PublishTicketBinding<Document>;
export const mintPublishTicket = mintTicket<Document>;
export const validatePublishTicket = validateTicket<Document>;
