import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier
import joblib
import os

def create_synthetic_data(num_samples=1000):
    np.random.seed(42)
    
    # Safe files generally have lower entropy, standard headers, and valid characteristics
    safe_samples = int(num_samples * 0.7)
    safe_data = {
        'SizeOfOptionalHeader': np.random.choice([224, 240], safe_samples),
        'Characteristics': np.random.randint(258, 8192, safe_samples),
        'MajorLinkerVersion': np.random.randint(6, 14, safe_samples),
        'SizeOfInitializedData': np.random.randint(1024, 102400, safe_samples),
        'Entropy': np.random.uniform(3.0, 6.0, safe_samples),
        'Malware': np.zeros(safe_samples, dtype=int)
    }
    
    # Malware files often have high entropy (packed/encrypted), unusual headers
    malware_samples = num_samples - safe_samples
    malware_data = {
        'SizeOfOptionalHeader': np.random.choice([0, 224, 240, 512], malware_samples),
        'Characteristics': np.random.randint(0, 65535, malware_samples),
        'MajorLinkerVersion': np.random.randint(0, 255, malware_samples),
        'SizeOfInitializedData': np.random.randint(0, 1024000, malware_samples),
        'Entropy': np.random.uniform(6.5, 8.0, malware_samples),
        'Malware': np.ones(malware_samples, dtype=int)
    }
    
    df_safe = pd.DataFrame(safe_data)
    df_malware = pd.DataFrame(malware_data)
    
    df = pd.concat([df_safe, df_malware], ignore_index=True)
    
    # Shuffle dataset
    df = df.sample(frac=1).reset_index(drop=True)
    return df

def main():
    print("Generating synthetic dataset...")
    df = create_synthetic_data(2000)
    
    X = df.drop('Malware', axis=1)
    y = df['Malware']
    
    print("Training RandomForestClassifier...")
    clf = RandomForestClassifier(n_estimators=100, random_state=42, max_depth=5)
    clf.fit(X, y)
    
    accuracy = clf.score(X, y)
    print(f"Model trained with training accuracy: {accuracy:.4f}")
    
    model_path = os.path.join(os.path.dirname(__file__), 'rf_model.pkl')
    joblib.dump(clf, model_path)
    print(f"Model successfully saved to {model_path}")

if __name__ == '__main__':
    main()
