plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "lab.zerone.launcher"
    compileSdk = 34

    defaultConfig {
        applicationId = "lab.zerone.launcher"
        minSdk = 23                     // Android 6.0 Marshmallow (BlackBerry Priv and friends)
        targetSdk = 34
        versionCode = 3
        versionName = "0.1.2"
    }
    signingConfigs {
        // CI injects a real keystore through secrets. Without them the release build falls
        // back to the debug key below, so a fresh clone still produces an installable APK.
        create("release") {
            val store = System.getenv("KEYSTORE_PATH")
            if (store != null && file(store).exists()) {
                storeFile = file(store)
                storePassword = System.getenv("KEYSTORE_PASSWORD")
                keyAlias = System.getenv("KEY_ALIAS")
                keyPassword = System.getenv("KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (System.getenv("KEYSTORE_PATH") != null)
                signingConfigs.getByName("release")
            else
                signingConfigs.getByName("debug")
        }
    }

    // The app ships no native code, so one APK already runs on armeabi-v7a, arm64-v8a,
    // x86 and x86_64 — per-ABI builds would be byte-identical apart from the version code.
    // Kept behind a flag so it starts working the day a native dependency lands:
    //   ./gradlew assembleRelease -PabiSplits=true
    splits {
        abi {
            isEnable = project.hasProperty("abiSplits")
            reset()
            include("armeabi-v7a", "arm64-v8a", "x86", "x86_64")
            isUniversalApk = true
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.2")
    implementation("androidx.webkit:webkit:1.11.0")
}
