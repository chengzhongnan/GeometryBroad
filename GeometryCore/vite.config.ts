import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  build: {
    // 使用库模式进行构建
    lib: {
      // 库的入口文件
      entry: path.resolve(__dirname, 'core/DSLInterpreter.ts'),
      // 在 UMD 构建模式下，暴露的全局变量名
      name: 'GeometryInterpreterLib',
      // 输出的文件名
      fileName: 'geometry-interpreter'
    },
    // 指定输出目录
    outDir: 'dist',
    // 构建前清空输出目录
    emptyOutDir: true,
  }
})