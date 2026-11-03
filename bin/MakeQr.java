import com.google.zxing.BarcodeFormat;
import com.google.zxing.client.j2se.MatrixToImageWriter;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.QRCodeWriter;

import java.io.File;
import java.nio.file.Path;

public class MakeQr {
    public static void main(String[] args) throws Exception {
        String text = args[0];
        String outPath = args[1];
        QRCodeWriter writer = new QRCodeWriter();
        BitMatrix matrix = writer.encode(text, BarcodeFormat.QR_CODE, 500, 500);
        MatrixToImageWriter.writeToPath(matrix, "PNG", new File(outPath).toPath());
        System.out.println("GENERATED: " + outPath + " for " + text);
    }
}
