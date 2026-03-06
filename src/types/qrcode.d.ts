declare module "qrcode" {
  export type QRCodeToDataURLOptions = {
    width?: number;
    margin?: number;
  };

  const QRCode: {
    toDataURL(text: string, options?: QRCodeToDataURLOptions): Promise<string>;
  };

  export default QRCode;
}
