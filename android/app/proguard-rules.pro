# kotlinx.serialization: keep the generated serializers of the app's own data classes.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt
-keepclassmembers class com.bdlnaredi.goatstack.** {
    *** Companion;
}
-keepclasseswithmembers class com.bdlnaredi.goatstack.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class com.bdlnaredi.goatstack.**$$serializer { *; }
# OkHttp ships its own rules; these quiet optional platform classes.
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
