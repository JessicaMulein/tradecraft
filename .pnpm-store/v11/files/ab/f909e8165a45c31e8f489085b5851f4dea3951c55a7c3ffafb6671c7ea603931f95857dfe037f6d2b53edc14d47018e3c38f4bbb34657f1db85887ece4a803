"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractFileFromTarball = extractFileFromTarball;
const tslib_1 = require("tslib");
const node_fs_1 = require("node:fs");
const path_1 = require("path");
const tar = tslib_1.__importStar(require("tar-stream"));
const zlib_1 = require("zlib");
/**
 * Extracts a file from a given tarball to the specified destination.
 * @param tarballPath The path to the tarball from where the file should be extracted.
 * @param file The path to the file inside the tarball.
 * @param destinationFilePath The destination file path.
 * @returns True if the file was extracted successfully, false otherwise.
 */
async function extractFileFromTarball(tarballPath, file, destinationFilePath) {
    return new Promise((resolve, reject) => {
        (0, node_fs_1.mkdirSync)((0, path_1.dirname)(destinationFilePath), { recursive: true });
        var tarExtractStream = tar.extract();
        const destinationFileStream = (0, node_fs_1.createWriteStream)(destinationFilePath);
        let isFileExtracted = false;
        tarExtractStream.on('entry', function (header, stream, next) {
            if (header.name === file) {
                stream.pipe(destinationFileStream);
                stream.on('end', () => {
                    isFileExtracted = true;
                });
                destinationFileStream.on('close', () => {
                    resolve(destinationFilePath);
                });
            }
            stream.on('end', function () {
                next();
            });
            stream.resume();
        });
        tarExtractStream.on('finish', function () {
            if (!isFileExtracted) {
                reject();
            }
        });
        (0, node_fs_1.createReadStream)(tarballPath).pipe((0, zlib_1.createGunzip)()).pipe(tarExtractStream);
    });
}
