import java.io.File;
import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import com.google.zxing.*;
import com.google.zxing.client.j2se.BufferedImageLuminanceSource;
import com.google.zxing.common.HybridBinarizer;

public class DecodeQr {
    public static void main(String[] args) {
        for (String path : args) {
            try {
                File file = new File(path);
                BufferedImage image = ImageIO.read(file);
                LuminanceSource source = new BufferedImageLuminanceSource(image);
                BinaryBitmap bitmap = new BinaryBitmap(new HybridBinarizer(source));
                Result result = new MultiFormatReader().decode(bitmap);
                System.out.println("DECODED [" + path + "]: " + result.getText());
            } catch (Exception e) {
                System.out.println("ERROR [" + path + "]: " + e.getMessage());
            }
        }
    }
}
