(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.I486 = root.I486 || {};
  for (var k in api) { if (Object.prototype.hasOwnProperty.call(api, k)) root.I486[k] = api[k]; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /*
   * HYFS, the tiny filesystem of the HY486 guest.
   *
   *   sector 0         boot sector, owned by guest.js (format() leaves it zeroed)
   *   sector 1         superblock
   *   sectors 2..9     directory, 128 entries of 32 bytes
   *   sectors 12..     data, contiguous clusters of 4 sectors, cluster N at LBA N*4
   *
   * Superblock (little-endian):
   *   0x00 u8[4] magic "HYFS"   0x04 u16 version      0x06 u16 sector size (512)
   *   0x08 u16 cluster sectors  0x0A u16 used entries 0x0C u32 total sectors
   *   0x10 u32 dir start (2)    0x14 u16 dir sectors  0x16 u16 data start (12)
   *   0x18 16    boot kernel name, ASCII, zero padded
   *
   * Directory entry: 0x00 12 name, 0x0C u32 first cluster, 0x10 u32 size,
   * 0x14 u8 attr, 0x15 11 reserved bytes. A zero first byte marks a free slot.
   *
   * Allocation is contiguous: new files take the clusters after the last one, so a
   * rewrite or a delete repacks the data area. The 16-bit guest keeps an LBA in a
   * word, which is what limits an image to 65535 sectors (32 MB).
   */

  var SECTOR_SIZE = 512;
  var CLUSTER_SECTORS = 4;
  var CLUSTER_SIZE = SECTOR_SIZE * CLUSTER_SECTORS;
  var SUPER_SECTOR = 1;
  var DIR_SECTOR = 2;
  var DIR_SECTORS = 8;
  var DATA_SECTOR = 12;
  var FIRST_CLUSTER = DATA_SECTOR / CLUSTER_SECTORS;
  var ENTRY_SIZE = 32;
  var DIR_ENTRIES = (DIR_SECTORS * SECTOR_SIZE) / ENTRY_SIZE;
  var MAX_SECTORS = 0xFFFF;
  var DEFAULT_SECTORS = 16384;
  var MAGIC = 'HYFS';
  var VERSION = 1;

  var SB_MAGIC = 0x00;
  var SB_VERSION = 0x04;
  var SB_SECTOR_SIZE = 0x06;
  var SB_CLUSTER_SECTORS = 0x08;
  var SB_FILE_COUNT = 0x0A;
  var SB_TOTAL_SECTORS = 0x0C;
  var SB_DIR_START = 0x10;
  var SB_DIR_SECTORS = 0x14;
  var SB_DATA_START = 0x16;
  var SB_BOOT_NAME = 0x18;
  var SB_BOOT_NAME_LEN = 16;

  var E_NAME = 0x00;
  var E_CLUSTER = 0x0C;
  var E_SIZE = 0x10;
  var E_ATTR = 0x14;

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function fail(message) { throw new Error('HYFS: ' + message); }

  function imageBytes(image) {
    if (image instanceof Uint8Array) return image;
    if (image instanceof ArrayBuffer) return new Uint8Array(image);
    if (Array.isArray(image)) return new Uint8Array(image);
    if (image && typeof image.byteLength === 'number' && image.buffer) {
      return new Uint8Array(image.buffer, image.byteOffset || 0, image.byteLength);
    }
    throw new Error('HYFS: an image must be a Uint8Array');
  }

  function viewOf(image) {
    return new DataView(image.buffer, image.byteOffset, image.byteLength);
  }

  function dataBytes(data) {
    if (data === null || data === undefined) return new Uint8Array(0);
    if (data instanceof Uint8Array) return data;
    if (typeof data === 'string') {
      var out = new Uint8Array(data.length), i;
      for (i = 0; i < data.length; i++) out[i] = data.charCodeAt(i) & 0xFF;
      return out;
    }
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (Array.isArray(data)) return new Uint8Array(data);
    if (data && typeof data.byteLength === 'number' && data.buffer) {
      return new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength);
    }
    fail('file data must be a Uint8Array, an array, a string or an ArrayBuffer');
  }

  function normName(name) {
    return String(name === null || name === undefined ? '' : name).replace(/\s+/g, '').toUpperCase();
  }

  function validName(name) {
    if (!name || name.length > 12) return false;
    return /^[A-Z0-9_-]{1,8}(\.[A-Z0-9_-]{1,3})?$/.test(name);
  }

  function entryName(bytes, offset) {
    var s = '', i, c;
    for (i = 0; i < 12; i++) {
      c = bytes[offset + i];
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s;
  }

  function writeName(target, offset, name) {
    var i;
    for (i = 0; i < 12; i++) target[offset + i] = i < name.length ? name.charCodeAt(i) & 0xFF : 0;
  }

  function checkMagic(image) {
    var i;
    if (image.length < (DIR_SECTOR + 1) * SECTOR_SIZE || image.length % SECTOR_SIZE !== 0) {
      fail('image is not a whole number of sectors');
    }
    for (i = 0; i < 4; i++) {
      if (image[SUPER_SECTOR * SECTOR_SIZE + i] !== MAGIC.charCodeAt(i)) fail('missing HYFS superblock');
    }
  }

  function superblock(image) {
    var img = imageBytes(image);
    checkMagic(img);
    var dv = viewOf(img), base = SUPER_SECTOR * SECTOR_SIZE, sb = { magic: MAGIC };
    sb.version = dv.getUint16(base + SB_VERSION, true);
    sb.sectorSize = dv.getUint16(base + SB_SECTOR_SIZE, true);
    sb.clusterSectors = dv.getUint16(base + SB_CLUSTER_SECTORS, true);
    sb.fileCount = dv.getUint16(base + SB_FILE_COUNT, true);
    sb.totalSectors = dv.getUint32(base + SB_TOTAL_SECTORS, true);
    sb.dirStart = dv.getUint32(base + SB_DIR_START, true);
    sb.dirSectors = dv.getUint16(base + SB_DIR_SECTORS, true);
    sb.dataStart = dv.getUint16(base + SB_DATA_START, true);
    sb.bootKernel = entryName(img, base + SB_BOOT_NAME);
    return sb;
  }

  function entries(image) {
    var img = imageBytes(image);
    checkMagic(img);
    var out = [], i, base, first, size, name;
    for (i = 0; i < DIR_ENTRIES; i++) {
      base = DIR_SECTOR * SECTOR_SIZE + i * ENTRY_SIZE;
      if (!img[base]) continue;
      name = entryName(img, base);
      first = img[base + E_CLUSTER] | (img[base + E_CLUSTER + 1] << 8) |
              (img[base + E_CLUSTER + 2] << 16) | (img[base + E_CLUSTER + 3] << 24);
      size = img[base + E_SIZE] | (img[base + E_SIZE + 1] << 8) |
             (img[base + E_SIZE + 2] << 16) | (img[base + E_SIZE + 3] << 24);
      out.push({
        name: name,
        size: size >>> 0,
        attr: img[base + E_ATTR],
        firstCluster: first >>> 0,
        index: i,
        offset: base
      });
    }
    return out;
  }

  function clusterCountOf(size) {
    return size > 0 ? Math.ceil(size / CLUSTER_SIZE) : 0;
  }

  function writeSuperblock(image, fields) {
    var dv = viewOf(image), base = SUPER_SECTOR * SECTOR_SIZE, i;
    for (i = 0; i < 4; i++) image[base + i] = MAGIC.charCodeAt(i);
    dv.setUint16(base + SB_VERSION, VERSION, true);
    dv.setUint16(base + SB_SECTOR_SIZE, SECTOR_SIZE, true);
    dv.setUint16(base + SB_CLUSTER_SECTORS, CLUSTER_SECTORS, true);
    dv.setUint16(base + SB_FILE_COUNT, fields.fileCount, true);
    dv.setUint32(base + SB_TOTAL_SECTORS, fields.totalSectors, true);
    dv.setUint32(base + SB_DIR_START, DIR_SECTOR, true);
    dv.setUint16(base + SB_DIR_SECTORS, DIR_SECTORS, true);
    dv.setUint16(base + SB_DATA_START, DATA_SECTOR, true);
    for (i = 0; i < SB_BOOT_NAME_LEN; i++) {
      image[base + SB_BOOT_NAME + i] = i < fields.bootKernel.length ? fields.bootKernel.charCodeAt(i) & 0xFF : 0;
    }
  }

  function writeEntry(image, index, file) {
    var base = DIR_SECTOR * SECTOR_SIZE + index * ENTRY_SIZE, dv = viewOf(image);
    writeName(image, base + E_NAME, file.name);
    dv.setUint32(base + E_CLUSTER, file.firstCluster >>> 0, true);
    dv.setUint32(base + E_SIZE, file.data.length >>> 0, true);
    image[base + E_ATTR] = file.attr & 0xFF;
  }

  /* Rewrites superblock, directory and data area of an existing image. Sector 0 and
     anything past the filesystem regions are left alone except the wiped data area. */
  function writeFs(image, files, bootKernel) {
    var sectors = image.length / SECTOR_SIZE;
    if (image.length % SECTOR_SIZE || sectors < DATA_SECTOR + CLUSTER_SECTORS) {
      fail('image is too small for a filesystem');
    }
    if (files.length > DIR_ENTRIES) fail('too many files, the directory holds ' + DIR_ENTRIES);
    var maxClusters = Math.floor(sectors / CLUSTER_SECTORS);
    var placed = [], cluster = FIRST_CLUSTER, i, f, need, j, used = 0;
    for (i = 0; i < files.length; i++) {
      f = files[i];
      if (!validName(f.name)) fail('bad file name "' + f.name + '"');
      for (j = 0; j < placed.length; j++) {
        if (placed[j].name === f.name) fail('duplicate file name "' + f.name + '"');
      }
      need = clusterCountOf(f.data.length);
      if (f.data.length > 0 && cluster + need > maxClusters) {
        fail('no room for ' + f.name + ', image holds ' + (maxClusters - FIRST_CLUSTER) + ' clusters');
      }
      placed.push({ name: f.name, data: f.data, attr: f.attr || 0, firstCluster: f.data.length ? cluster : 0, size: f.data.length });
      cluster += need;
      used += need;
    }
    image.fill(0, SECTOR_SIZE);
    writeSuperblock(image, {
      fileCount: placed.length,
      totalSectors: sectors,
      bootKernel: bootKernel || ''
    });
    for (i = 0; i < placed.length; i++) {
      writeEntry(image, i, placed[i]);
      if (placed[i].size) image.set(placed[i].data, placed[i].firstCluster * CLUSTER_SIZE);
    }
    return { sectors: sectors, files: placed.length, usedClusters: used, freeClusters: maxClusters - FIRST_CLUSTER - used };
  }

  function normalizeFiles(list) {
    var out = [], i, f, name, data;
    for (i = 0; i < (list || []).length; i++) {
      f = list[i];
      if (!f) fail('file entry ' + i + ' is empty');
      name = normName(f.name);
      if (!validName(name)) fail('bad file name "' + (f && f.name) + '"');
      data = dataBytes(f.data);
      out.push({ name: name, data: data, attr: (f.attr | 0) & 0xFF });
    }
    return out;
  }

  function collectFiles(image) {
    var list = entries(image), out = [], i, e;
    for (i = 0; i < list.length; i++) {
      e = list[i];
      out.push({ name: e.name, data: readFile(image, e.name) || new Uint8Array(0), attr: e.attr });
    }
    return out;
  }

  function format(opts) {
    opts = opts || {};
    var sectors = opts.sectors === undefined || opts.sectors === null ? DEFAULT_SECTORS : (opts.sectors | 0);
    if (sectors < DATA_SECTOR + CLUSTER_SECTORS) {
      fail('format needs at least ' + (DATA_SECTOR + CLUSTER_SECTORS) + ' sectors');
    }
    if (sectors > MAX_SECTORS) fail('format allows at most ' + MAX_SECTORS + ' sectors');
    var files = normalizeFiles(opts.files || []);
    var bootKernel = opts.bootKernel ? normName(opts.bootKernel) : '';
    if (bootKernel && !validName(bootKernel)) fail('bad boot kernel name "' + opts.bootKernel + '"');
    var image = new Uint8Array(sectors * SECTOR_SIZE);
    writeFs(image, files, bootKernel);
    return image;
  }

  function list(image) {
    var all = entries(image), out = [], i;
    for (i = 0; i < all.length; i++) out.push({ name: all[i].name, size: all[i].size, attr: all[i].attr });
    return out;
  }

  function findEntry(image, name) {
    var want = normName(name), all = entries(image), i;
    for (i = 0; i < all.length; i++) if (all[i].name === want) return all[i];
    return null;
  }

  function readFile(image, name) {
    var e = findEntry(image, name);
    if (!e) return null;
    var start = e.firstCluster * CLUSTER_SIZE;
    if (start + e.size > image.length) return null;
    return imageBytes(image).slice(start, start + e.size);
  }

  function replaceFs(image, files) {
    var boot = superblock(image).bootKernel;
    var scratch = new Uint8Array(image.length);
    writeFs(scratch, files, boot);
    image.set(scratch.subarray(SECTOR_SIZE), SECTOR_SIZE);
  }

  function writeFile(image, name, data) {
    var nm = normName(name);
    if (!validName(nm)) return false;
    var img = imageBytes(image);
    var bytes = dataBytes(data);
    var files, i, found = false;
    try {
      files = collectFiles(img);
      for (i = 0; i < files.length; i++) {
        if (files[i].name === nm) { files[i].data = bytes; found = true; break; }
      }
      if (!found) files.push({ name: nm, data: bytes, attr: 0 });
      replaceFs(img, files);
    } catch (e) {
      return false;
    }
    return true;
  }

  function deleteFile(image, name) {
    var nm = normName(name);
    var img = imageBytes(image);
    var files, kept = [], i, found = false;
    try {
      files = collectFiles(img);
      for (i = 0; i < files.length; i++) {
        if (files[i].name === nm) { found = true; continue; }
        kept.push(files[i]);
      }
      if (!found) return false;
      replaceFs(img, kept);
    } catch (e) {
      return false;
    }
    return true;
  }

  function check(image) {
    var out = { ok: true, errors: [], files: 0, sectors: 0, usedClusters: 0, freeClusters: 0 };
    var img, sb, all, i, j, e, need, start, end;
    try {
      img = imageBytes(image);
      if (img.length % SECTOR_SIZE) out.errors.push('image length ' + img.length + ' is not a multiple of ' + SECTOR_SIZE);
      if (img.length < (DATA_SECTOR + CLUSTER_SECTORS) * SECTOR_SIZE) out.errors.push('image is too small for a filesystem');
      sb = superblock(img);
      out.sectors = sb.totalSectors;
      if (sb.version !== VERSION) out.errors.push('superblock version ' + sb.version + ' is not ' + VERSION);
      if (sb.sectorSize !== SECTOR_SIZE) out.errors.push('superblock sector size ' + sb.sectorSize + ' is not ' + SECTOR_SIZE);
      if (sb.clusterSectors !== CLUSTER_SECTORS) out.errors.push('superblock cluster size ' + sb.clusterSectors + ' is not ' + CLUSTER_SECTORS);
      if (sb.dirStart !== DIR_SECTOR) out.errors.push('superblock directory start ' + sb.dirStart + ' is not ' + DIR_SECTOR);
      if (sb.dirSectors !== DIR_SECTORS) out.errors.push('superblock directory sectors ' + sb.dirSectors + ' is not ' + DIR_SECTORS);
      if (sb.dataStart !== DATA_SECTOR) out.errors.push('superblock data start ' + sb.dataStart + ' is not ' + DATA_SECTOR);
      if (sb.totalSectors * SECTOR_SIZE !== img.length) {
        out.errors.push('superblock total sectors ' + sb.totalSectors + ' does not match image size ' + img.length);
      }
      all = entries(img);
      out.files = all.length;
      if (sb.fileCount !== all.length) out.errors.push('superblock file count ' + sb.fileCount + ' but ' + all.length + ' entries');
      var maxClusters = Math.floor(sb.totalSectors / sb.clusterSectors);
      for (i = 0; i < all.length; i++) {
        e = all[i];
        if (!validName(e.name)) out.errors.push('entry ' + i + ' has a bad name "' + e.name + '"');
        need = clusterCountOf(e.size);
        if (need) {
          if (e.firstCluster < FIRST_CLUSTER) out.errors.push(e.name + ' starts at cluster ' + e.firstCluster + ' inside the filesystem area');
          start = e.firstCluster;
          end = e.firstCluster + need;
          if (end > maxClusters) out.errors.push(e.name + ' runs past the last cluster');
          for (j = 0; j < i; j++) {
            var o = all[j], oend = o.firstCluster + clusterCountOf(o.size);
            if (clusterCountOf(o.size) && start < oend && start + need > o.firstCluster) {
              out.errors.push(e.name + ' overlaps ' + o.name);
            }
          }
          out.usedClusters += need;
        } else if (e.size !== 0) {
          out.errors.push(e.name + ' has a size but no cluster');
        }
      }
      out.freeClusters = maxClusters - FIRST_CLUSTER - out.usedClusters;
      if (out.freeClusters < 0) out.errors.push('files use more clusters than the image has');
    } catch (err) {
      out.errors.push(err && err.message ? err.message : String(err));
    }
    out.ok = out.errors.length === 0;
    return out;
  }

  function mount(image) {
    var img = imageBytes(image);
    var view = {
      image: img,
      files: [],
      list: function () { return list(img); },
      readFile: function (name) { return readFile(img, name); },
      writeFile: function (name, data) {
        var ok = writeFile(img, name, data);
        view.refresh();
        return ok;
      },
      deleteFile: function (name) {
        var ok = deleteFile(img, name);
        view.refresh();
        return ok;
      },
      refresh: function () {
        view.files = list(img);
        return view;
      }
    };
    return view.refresh();
  }

  var Disk = {
    SECTOR_SIZE: SECTOR_SIZE,
    CLUSTER_SECTORS: CLUSTER_SECTORS,
    CLUSTER_SIZE: CLUSTER_SIZE,
    SUPER_SECTOR: SUPER_SECTOR,
    DIR_SECTOR: DIR_SECTOR,
    DIR_SECTORS: DIR_SECTORS,
    DIR_ENTRIES: DIR_ENTRIES,
    DATA_SECTOR: DATA_SECTOR,
    FIRST_CLUSTER: FIRST_CLUSTER,
    ENTRY_SIZE: ENTRY_SIZE,
    MAX_SECTORS: MAX_SECTORS,
    format: format,
    list: list,
    entries: entries,
    superblock: superblock,
    readFile: readFile,
    writeFile: writeFile,
    deleteFile: deleteFile,
    mount: mount,
    check: check,
    normalizeName: normName,
    validName: validName
  };

  return { Disk: Disk };
});
