package com.bdlnaredi.goatstack

import android.app.Application
import coil.ImageLoader
import coil.ImageLoaderFactory
import coil.disk.DiskCache
import coil.memory.MemoryCache
import com.bdlnaredi.goatstack.data.AppState
import com.bdlnaredi.goatstack.data.Store

class GoatApp : Application(), ImageLoaderFactory {
    lateinit var state: AppState
        private set

    override fun onCreate() {
        super.onCreate()
        state = AppState(Store(this))
    }

    // Pictures go through the same connection as everything else, so artwork the server serves (which needs the
    // sign-in) loads too. Kept on disk so posters do not download again every time.
    override fun newImageLoader(): ImageLoader = ImageLoader.Builder(this)
        .okHttpClient(state.api.client)
        .crossfade(!com.bdlnaredi.goatstack.ui.Tuning.still)
        .allowHardware(!com.bdlnaredi.goatstack.ui.Tuning.still)
        .memoryCache { MemoryCache.Builder(this).maxSizePercent(0.2).build() }
        .diskCache { DiskCache.Builder().directory(cacheDir.resolve("posters")).maxSizeBytes(150L * 1024 * 1024).build() }
        .respectCacheHeaders(false)
        .build()
}
