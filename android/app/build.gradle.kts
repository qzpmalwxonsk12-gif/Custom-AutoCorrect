plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Names the APK "app-AutoCorrect-<buildType>.apk" instead of "app-debug.apk".
// The build-type suffix is kept deliberately: a debug and a release APK must
// never end up with the same filename in the outputs directory.
base {
    archivesName.set("app-AutoCorrect")
}

android {
    namespace = "com.arjun.autocorrect"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.arjun.autocorrect"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            // Private sideloaded build: keep it debuggable-by-inspection and
            // avoid shrinking the engine's reflection-free but asset-driven code.
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        viewBinding = true
    }

    androidResources {
        // The dictionary asset is already compact; compressing it costs decode
        // time on every cold start for a few hundred KB of storage.
        noCompress += listOf("dict")
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("androidx.recyclerview:recyclerview:1.3.2")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.8.4")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.8.1")
}
