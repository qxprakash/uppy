import fs from 'fs';
import path from 'path';

const packageJsonPath = path.resolve('package.json');
let packageJson;
try {
  const fileContents = fs.readFileSync(packageJsonPath, 'utf8');
  packageJson = JSON.parse(fileContents);
} catch (error) {
  console.error('Error reading or parsing package.json:', error);
  process.exit(1);
}


const keysToUpdate = ['dependencies', 'devDependencies', 'peerDependencies'];

let updated = false;
for (const key of keysToUpdate) {
  const dependencies = packageJson[key];
  if (dependencies) {
    for (const depName in dependencies) {
      if (dependencies[depName] === 'workspace:*') {
        console.log(`Updating ${depName} from "workspace:*" to "latest".`);
        dependencies[depName] = 'latest';
        updated = true;
      }
    }
  }
}

if (updated) {
  try {
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
    console.log('Successfully updated package.json for StackBlitz.');
  } catch (error) {
    console.error('Error writing updated package.json:', error);
    process.exit(1);
  }
} else {
  console.log('No "workspace:*" dependencies found to update.');
}
