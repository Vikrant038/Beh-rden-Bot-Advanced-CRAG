export type EnvelopeSuccess<T> = {
  success: true;
  data: T;
};

export type EnvelopeError = {
  success: false;
  message: string;
  code: string;
};

export type Envelope<T> = EnvelopeSuccess<T> | EnvelopeError;

export function ok<T>(data: T): EnvelopeSuccess<T> {
  return { success: true, data };
}

export function fail(message: string, code: string): EnvelopeError {
  return { success: false, message, code };
}
