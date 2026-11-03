# Proguard rules for Loyalty Reward Android Apps
-keepattributes *Annotation*
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
